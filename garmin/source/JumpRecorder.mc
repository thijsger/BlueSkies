import Toybox.Lang;
import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.ActivityMonitor;
import Toybox.Position;
import Toybox.Sensor;
import Toybox.Timer;
import Toybox.Time;
import Toybox.Attention;
import Toybox.System;
import Toybox.Communications;
import Toybox.Application;
import Toybox.Math;
import Toybox.WatchUi;
import Toybox.Graphics;

// Records a jump: 1 Hz time-series for the backend payload + a full-fidelity
// FIT file via ActivityRecording (backup ingestion). Runs an automatic phase
// state machine (no taps needed mid-jump) and POSTs JSON on stop.
class JumpRecorder {

    enum {
        PH_CLIMB = 0,
        PH_EXIT = 1,
        PH_FREEFALL = 2,
        PH_CANOPY = 3,
        PH_LANDED = 4
    }

    var mRecording as Boolean = false;
    var mSession = null;
    var mTimer as Timer.Timer? = null;
    var mStartSec as Number = 0;
    var mHasBaro as Boolean = false;
    var mPosted as Boolean = false;
    var mPostMsg as String = "";

    // 1 Hz series
    var mT as Array = [];
    var mAlt as Array = [];
    var mHr as Array = [];
    var mLat as Array = [];
    var mLng as Array = [];
    var mPh as Array = [];

    // last GPS fix (fallback if Activity.Info.currentLocation is null)
    var mLastLat = null;
    var mLastLng = null;

    // state machine
    var mPhase as Number = PH_CLIMB;
    var mMaxAlt = null;
    var mLastAlt = null;
    var mExitAlt = null;
    var mFreefallStartT as Number = -1;
    var mFreefallEndT as Number = -1;
    var mCanopyStartT as Number = -1;
    var mLandedT as Number = -1;
    var mPeakHr as Number = 0;
    var mPeakFall as Float = 0.0;
    var mPeakAccel as Float = 0.0;
    var mStable as Number = 0;

    function initialize() {
        var info = ActivityMonitor.getInfo();
        // Barometer presence heuristic per the spec.
        mHasBaro = (info != null) && (info has :floorsClimbed);
    }

    function isRecording() as Boolean { return mRecording; }
    function getPhase() as Number { return mPhase; }
    function hasBaro() as Boolean { return mHasBaro; }
    function getPostMessage() as String { return mPostMsg; }

    function getExitAlt() { return mExitAlt; }
    function getPeakHr() as Number { return mPeakHr; }
    function getPeakFall() as Float { return mPeakFall; }

    function getFreefallTime() as Number {
        if (mFreefallStartT < 0) { return 0; }
        var end = mFreefallEndT >= 0 ? mFreefallEndT : nowT();
        return end - mFreefallStartT;
    }

    function getCanopyTime() as Number {
        if (mCanopyStartT < 0) { return 0; }
        var end = mLandedT >= 0 ? mLandedT : nowT();
        return end - mCanopyStartT;
    }

    function nowT() as Number {
        return Time.now().value() - mStartSec;
    }

    function getCurrentAlt() {
        if (mAlt.size() == 0) { return null; }
        return mAlt[mAlt.size() - 1];
    }
    function getCurrentHr() {
        if (mHr.size() == 0) { return null; }
        return mHr[mHr.size() - 1];
    }

    function getPhaseLabel() as String {
        switch (mPhase) {
            case PH_CLIMB: return "KLIM";
            case PH_EXIT: return "EXIT";
            case PH_FREEFALL: return "VRIJE VAL";
            case PH_CANOPY: return "CANOPY";
            case PH_LANDED: return "GELAND";
        }
        return "";
    }

    function getPhaseColor() as Number {
        switch (mPhase) {
            case PH_CLIMB: return 0x3B82F6;
            case PH_EXIT: return 0xF59E0B;
            case PH_FREEFALL: return 0xEF4444;
            case PH_CANOPY: return 0x10B981;
            case PH_LANDED: return 0x9CA3AF;
        }
        return Graphics.COLOR_WHITE;
    }

    // -------------------------------------------------------------- start/stop
    function start() as Void {
        if (mRecording) { return; }
        mT = []; mAlt = []; mHr = []; mLat = []; mLng = []; mPh = [];
        mPhase = PH_CLIMB;
        mMaxAlt = null; mLastAlt = null; mExitAlt = null;
        mFreefallStartT = -1; mFreefallEndT = -1; mCanopyStartT = -1; mLandedT = -1;
        mPeakHr = 0; mPeakFall = 0.0; mPeakAccel = 0.0; mStable = 0;
        mPosted = false; mPostMsg = "";
        mStartSec = Time.now().value();

        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));

        // High-rate accelerometer logging (used as a freefall cue). Falls back
        // silently to the 1 Hz Activity.Info path if unavailable.
        try {
            var opts = {
                :period => 1,
                :accelerometer => { :enabled => true, :sampleRate => 25 }
            };
            Sensor.registerSensorDataListener(method(:onSensorData), opts);
        } catch (e) {
            // high-rate not supported; 1 Hz sampling still active
        }

        // FIT recording (backup ingestion path).
        if (Toybox has :ActivityRecording) {
            mSession = ActivityRecording.createSession({
                :name => "Skydive",
                :sport => Activity.SPORT_GENERIC
            });
            mSession.start();
        }

        mTimer = new Timer.Timer();
        mTimer.start(method(:onTick), 1000, true);
        mRecording = true;
        vibrate(1);
    }

    function stop() as Void {
        if (!mRecording) { return; }
        mRecording = false;

        if (mTimer != null) { mTimer.stop(); mTimer = null; }
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
        try { Sensor.unregisterSensorDataListener(); } catch (e) {}

        if (mFreefallStartT >= 0 && mFreefallEndT < 0) {
            mFreefallEndT = nowT();
        }

        if (mSession != null) {
            mSession.stop();
            mSession.save();   // writes the .FIT file
            mSession = null;
        }

        postToBackend();
    }

    // -------------------------------------------------------------- callbacks
    function onPosition(info as Position.Info) as Void {
        if (info != null && info.position != null) {
            var deg = info.position.toDegrees();
            mLastLat = deg[0];
            mLastLng = deg[1];
        }
    }

    function onSensorData(data as Sensor.SensorData) as Void {
        if (data has :accelerometerData && data.accelerometerData != null) {
            var a = data.accelerometerData;
            var xs = a.x;
            var ys = a.y;
            var zs = a.z;
            if (xs != null && ys != null && zs != null) {
                for (var i = 0; i < xs.size(); i++) {
                    var mag = Math.sqrt(
                        (xs[i].toFloat() * xs[i]) +
                        (ys[i].toFloat() * ys[i]) +
                        (zs[i].toFloat() * zs[i]));
                    if (mag > mPeakAccel) { mPeakAccel = mag; }
                }
            }
        }
    }

    function onTick() as Void {
        var t = nowT();
        var info = Activity.getActivityInfo();

        var alt = null;
        var hr = null;
        var lat = mLastLat;
        var lng = mLastLng;

        if (info != null) {
            if (mHasBaro && info.altitude != null) { alt = info.altitude; }
            if (info.currentHeartRate != null) { hr = info.currentHeartRate; }
            if (info.currentLocation != null) {
                var deg = info.currentLocation.toDegrees();
                lat = deg[0];
                lng = deg[1];
            }
        }

        mT.add(t);
        mAlt.add(alt);
        mHr.add(hr);
        mLat.add(lat);
        mLng.add(lng);

        if (hr != null && hr > mPeakHr) { mPeakHr = hr; }

        updateStateMachine(t, alt);
        mPh.add(mPhase);

        WatchUi.requestUpdate();
    }

    // -------------------------------------------------------------- state machine
    // Real-time, baro-driven (with accel cue). The backend recomputes the
    // authoritative phase bands; this drives on-watch UI + haptics only.
    function updateStateMachine(t as Number, alt) as Void {
        if (alt == null) { return; }
        if (mMaxAlt == null || alt > mMaxAlt) { mMaxAlt = alt; }

        var fall = 0.0;
        if (mLastAlt != null) { fall = (mLastAlt - alt).toFloat(); } // m/s descent @1Hz
        mLastAlt = alt;
        if (fall > mPeakFall) { mPeakFall = fall; }

        var freefallCue = (fall > 25.0) || (mPeakAccel < 200.0 && fall > 12.0);
        var prev = mPhase;

        if (mPhase == PH_CLIMB) {
            if (fall > 8.0) {
                mPhase = PH_EXIT;
                mExitAlt = alt; // exit-altitude estimate captured while still high
            }
        } else if (mPhase == PH_EXIT) {
            if (freefallCue) {
                mPhase = PH_FREEFALL;
                mFreefallStartT = t;
            } else if (fall < 3.0) {
                mPhase = PH_CLIMB; // false alarm
            }
        } else if (mPhase == PH_FREEFALL) {
            if (fall < 12.0) {
                mStable += 1;
                if (mStable >= 2) {
                    mPhase = PH_CANOPY;
                    mFreefallEndT = t;
                    mCanopyStartT = t;
                    mStable = 0;
                }
            } else {
                mStable = 0;
            }
        } else if (mPhase == PH_CANOPY) {
            // landed: sustained low descent (server refines with ground altitude)
            if (fall < 1.0 && fall > -1.0) {
                mStable += 1;
                if (mStable >= 5) {
                    mPhase = PH_LANDED;
                    mLandedT = t;
                }
            } else {
                mStable = 0;
            }
        }

        // accel peak resets each second so it reflects the current window
        mPeakAccel = 0.0;

        if (mPhase != prev) {
            vibrate(mPhase == PH_FREEFALL ? 3 : 1);
        }
    }

    function vibrate(count as Number) as Void {
        if (Attention has :vibrate) {
            var profile = [];
            for (var i = 0; i < count; i++) {
                profile.add(new Attention.VibeProfile(75, 250));
                profile.add(new Attention.VibeProfile(0, 120));
            }
            Attention.vibrate(profile);
        }
    }

    // -------------------------------------------------------------- backend
    function postToBackend() as Void {
        var base = Application.Properties.getValue("backendUrl");
        if (base == null || base.length() == 0) {
            mPostMsg = "Geen backend-URL";
            return;
        }
        // strip trailing slash so we never build a "//api" path
        while (base.length() > 0 && base.substring(base.length() - 1, base.length()).equals("/")) {
            base = base.substring(0, base.length() - 1);
        }
        var url = base + "/api/jumps";

        var summary = {
            "exitAltitude" => mExitAlt,
            "freefallTime" => getFreefallTime(),
            "canopyTime" => getCanopyTime(),
            "peakVerticalSpeed" => mPeakFall,
            "peakHr" => mPeakHr
        };

        var payload = {
            "schema" => "skydive.v1",
            "source" => "live",
            "device" => "venu3",
            "startTime" => mStartSec,
            "summary" => summary,
            "series" => {
                "t" => mT,
                "alt" => mAlt,
                "hr" => mHr,
                "lat" => mLat,
                "lng" => mLng,
                "ph" => mPh
            }
        };

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        mPostMsg = "Versturen...";
        Communications.makeWebRequest(url, payload, options, method(:onPostResponse));
    }

    function onPostResponse(code as Number, data as Lang.Dictionary or Lang.String or Toybox.PersistedContent.Iterator or Null) as Void {
        if (code == 200 || code == 201) {
            mPosted = true;
            mPostMsg = "Verstuurd ✓";
        } else if (code == -400) {
            // Geen geldige JSON terug -> backend-URL wijst niet naar de server.
            mPostMsg = "Geen server op URL. Check Backend URL. FIT bewaard.";
        } else if (code < 0) {
            mPostMsg = "Geen verbinding (" + code + "). FIT bewaard.";
        } else {
            mPostMsg = "Upload faalde (" + code + "). FIT bewaard.";
        }
        WatchUi.requestUpdate();
    }
}
