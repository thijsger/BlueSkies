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

// Records a jump: adaptive-rate time-series for the backend (4 Hz in freefall,
// 1 Hz otherwise) + a full-fidelity FIT file via ActivityRecording. Freefall is
// detected fast from the accelerometer (near-0 g) with a baro fallback. Uploads
// go through the offline-proof Uploader queue.
class JumpRecorder {

    enum {
        PH_CLIMB = 0,
        PH_EXIT = 1,
        PH_FREEFALL = 2,
        PH_CANOPY = 3,
        PH_LANDED = 4
    }

    const TIMER_MS = 250;        // 4 Hz base tick
    const AUTO_STOP_SEC = 120;   // auto-stop this long after landing

    var mRecording as Boolean = false;
    var mSession = null;
    var mTimer as Timer.Timer? = null;
    var mStartSec as Number = 0;     // epoch seconds (payload startTime)
    var mStartMs as Number = 0;      // System.getTimer() at start (relative t)
    var mTick as Number = 0;
    var mHasBaro as Boolean = false;
    var mPostMsg as String = "";
    var mUploader as Uploader? = null;
    var mStoppedCb as Lang.Method? = null;

    // series
    var mT as Array = [];
    var mAlt as Array = [];
    var mHr as Array = [];
    var mLat as Array = [];
    var mLng as Array = [];
    var mPh as Array = [];

    var mLastLat = null;
    var mLastLng = null;

    // idle readiness
    var mIdleTimer as Timer.Timer? = null;
    var mIdleActive as Boolean = false;
    var mGpsQuality as Number = 0;
    var mIdleHr = null;

    // accel window stats (per onSensorData batch, ~1 s)
    var mAccelMean = null;
    var mAccelMin = null;
    var mPeakAccel as Float = 0.0;

    // state machine
    var mPhase as Number = PH_CLIMB;
    var mMaxAlt = null;
    var mLastAlt = null;
    var mPrevSecAlt = null;
    var mExitAlt = null;
    var mFreefallStartT as Float = -1.0;
    var mFreefallEndT as Float = -1.0;
    var mCanopyStartT as Float = -1.0;
    var mLandedT as Float = -1.0;
    var mPeakHr as Number = 0;
    var mPeakFall as Float = 0.0;
    var mStable as Number = 0;
    var mFastLow as Number = 0;

    function initialize() {
        var info = ActivityMonitor.getInfo();
        mHasBaro = (info != null) && (info has :floorsClimbed);
    }

    function setStoppedHandler(cb as Lang.Method) as Void { mStoppedCb = cb; }

    function isRecording() as Boolean { return mRecording; }
    function getPhase() as Number { return mPhase; }
    function hasBaro() as Boolean { return mHasBaro; }
    function getPostMessage() as String { return mPostMsg; }
    function getGpsQuality() as Number { return mGpsQuality; }
    function getIdleHr() { return mIdleHr; }
    function getPendingUploads() as Number { return (mUploader != null) ? mUploader.pendingCount() : (new Uploader()).pendingCount(); }

    function getExitAlt() { return mExitAlt; }
    function getPeakHr() as Number { return mPeakHr; }
    function getPeakFall() as Float { return mPeakFall; }

    function nowT() as Float {
        return (System.getTimer() - mStartMs) / 1000.0;
    }

    function getFreefallTime() as Float {
        if (mFreefallStartT < 0) { return 0.0; }
        var end = mFreefallEndT >= 0 ? mFreefallEndT : nowT();
        return end - mFreefallStartT;
    }
    function getCanopyTime() as Float {
        if (mCanopyStartT < 0) { return 0.0; }
        var end = mLandedT >= 0 ? mLandedT : nowT();
        return end - mCanopyStartT;
    }

    function getCurrentAlt() { return (mAlt.size() == 0) ? mLastAlt : mAlt[mAlt.size() - 1]; }
    function getCurrentHr() { return (mHr.size() == 0) ? null : mHr[mHr.size() - 1]; }

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
            case PH_CLIMB: return 0x4F8DFF;
            case PH_EXIT: return 0xF6A23B;
            case PH_FREEFALL: return 0xF43F6E;
            case PH_CANOPY: return 0x10D68A;
            case PH_LANDED: return 0x8A93A8;
        }
        return Graphics.COLOR_WHITE;
    }

    // ---------------------------------------------------------- idle readiness
    function startIdle() as Void {
        if (mIdleActive || mRecording) { return; }
        mIdleActive = true;
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        try {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
            Sensor.enableSensorEvents(method(:onSensorEvent));
        } catch (e) {}
        mIdleTimer = new Timer.Timer();
        mIdleTimer.start(method(:onIdleTick), 2000, true);
    }

    function stopIdle() as Void {
        if (!mIdleActive) { return; }
        mIdleActive = false;
        if (mIdleTimer != null) { mIdleTimer.stop(); mIdleTimer = null; }
        try { Sensor.enableSensorEvents(null); } catch (e) {}
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
    }

    function onIdleTick() as Void { WatchUi.requestUpdate(); }

    function onSensorEvent(info as Sensor.Info) as Void {
        if (info != null && info.heartRate != null) { mIdleHr = info.heartRate; }
    }

    // ---------------------------------------------------------- start/stop
    function start() as Void {
        if (mRecording) { return; }
        stopIdle();

        mT = []; mAlt = []; mHr = []; mLat = []; mLng = []; mPh = [];
        mPhase = PH_CLIMB; mTick = 0;
        mMaxAlt = null; mLastAlt = null; mPrevSecAlt = null; mExitAlt = null;
        mFreefallStartT = -1.0; mFreefallEndT = -1.0; mCanopyStartT = -1.0; mLandedT = -1.0;
        mPeakHr = 0; mPeakFall = 0.0; mPeakAccel = 0.0; mStable = 0; mFastLow = 0;
        mAccelMean = null; mAccelMin = null;
        mPostMsg = "";
        mStartSec = Time.now().value();
        mStartMs = System.getTimer();

        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        try {
            Sensor.registerSensorDataListener(method(:onSensorData), {
                :period => 1,
                :accelerometer => { :enabled => true, :sampleRate => 25 }
            });
        } catch (e) {}

        if (Toybox has :ActivityRecording) {
            mSession = ActivityRecording.createSession({
                :name => "Skydive", :sport => Activity.SPORT_GENERIC
            });
            mSession.start();
        }

        mTimer = new Timer.Timer();
        mTimer.start(method(:onTick), TIMER_MS, true);
        mRecording = true;
        vibrate(1);
    }

    function stop() as Void {
        if (!mRecording) { return; }
        mRecording = false;

        if (mTimer != null) { mTimer.stop(); mTimer = null; }
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
        try { Sensor.unregisterSensorDataListener(); } catch (e) {}

        if (mFreefallStartT >= 0 && mFreefallEndT < 0) { mFreefallEndT = nowT(); }

        if (mSession != null) {
            mSession.stop();
            mSession.save();   // writes the .FIT file
            mSession = null;
        }

        uploadJump();

        if (mStoppedCb != null) { mStoppedCb.invoke(); }
    }

    // ---------------------------------------------------------- callbacks
    function onPosition(info as Position.Info) as Void {
        if (info == null) { return; }
        if (info.position != null) {
            var deg = info.position.toDegrees();
            mLastLat = deg[0];
            mLastLng = deg[1];
        }
        if (info.accuracy != null) { mGpsQuality = info.accuracy; }
    }

    function onSensorData(data as Sensor.SensorData) as Void {
        if (data has :accelerometerData && data.accelerometerData != null) {
            var a = data.accelerometerData;
            var xs = a.x; var ys = a.y; var zs = a.z;
            if (xs != null && ys != null && zs != null && xs.size() > 0) {
                var sum = 0.0; var mn = null; var pk = 0.0; var n = xs.size();
                for (var i = 0; i < n; i++) {
                    var mag = Math.sqrt((xs[i].toFloat() * xs[i]) + (ys[i].toFloat() * ys[i]) + (zs[i].toFloat() * zs[i]));
                    sum += mag;
                    if (mn == null || mag < mn) { mn = mag; }
                    if (mag > pk) { pk = mag; }
                }
                mAccelMean = sum / n;
                mAccelMin = mn;
                mPeakAccel = pk;
            }
        }
    }

    function onTick() as Void {
        mTick += 1;
        var slow = (mTick % 4 == 0); // ~1 Hz
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
                lat = deg[0]; lng = deg[1];
            }
        }
        if (alt != null) { mLastAlt = alt; }
        if (hr != null && hr > mPeakHr) { mPeakHr = hr; }

        // fast accelerometer-based freefall onset (every 250 ms)
        fastFreefallCheck(t);

        // baro state machine at ~1 Hz
        if (slow) {
            var fall = 0.0;
            if (mPrevSecAlt != null && alt != null) { fall = (mPrevSecAlt - alt).toFloat(); }
            if (alt != null) { mPrevSecAlt = alt; }
            updateStateMachine(t, alt, fall);
        }

        // adaptive sampling: 4 Hz in freefall, 1 Hz otherwise
        if (mPhase == PH_FREEFALL || slow) {
            mT.add((t * 10).toNumber() / 10.0);
            mAlt.add(alt);
            mHr.add(hr);
            mLat.add(lat);
            mLng.add(lng);
            mPh.add(mPhase);
        }

        // auto-stop a couple of minutes after landing
        if (mPhase == PH_LANDED && mLandedT >= 0 && (t - mLandedT) > AUTO_STOP_SEC) {
            stop();
            return;
        }

        if (slow) { WatchUi.requestUpdate(); }
    }

    function fastFreefallCheck(t as Float) as Void {
        if ((mPhase == PH_CLIMB || mPhase == PH_EXIT) && mAccelMean != null && mAccelMean < 500.0) {
            mFastLow += 1;
            if (mFastLow >= 4) { // ~1 s sustained near-0 g
                if (mExitAlt == null) { mExitAlt = mLastAlt; }
                mPhase = PH_FREEFALL;
                if (mFreefallStartT < 0) { mFreefallStartT = t; }
                mFastLow = 0;
                vibrate(3);
            }
        } else {
            mFastLow = 0;
        }
    }

    function updateStateMachine(t as Float, alt, fall as Float) as Void {
        if (alt == null) { return; }
        if (mMaxAlt == null || alt > mMaxAlt) { mMaxAlt = alt; }
        if (fall > mPeakFall) { mPeakFall = fall; }

        var accelBack = (mAccelMean != null && mAccelMean > 800.0);
        var prev = mPhase;

        if (mPhase == PH_CLIMB) {
            if (fall > 8.0) { mPhase = PH_EXIT; mExitAlt = alt; }
        } else if (mPhase == PH_EXIT) {
            if (fall > 25.0) { mPhase = PH_FREEFALL; if (mFreefallStartT < 0) { mFreefallStartT = t; } }
            else if (fall < 3.0) { mPhase = PH_CLIMB; }
        } else if (mPhase == PH_FREEFALL) {
            if (fall < 12.0 || accelBack) {
                mStable += 1;
                if (mStable >= 2) {
                    mPhase = PH_CANOPY; mFreefallEndT = t; mCanopyStartT = t; mStable = 0;
                }
            } else { mStable = 0; }
        } else if (mPhase == PH_CANOPY) {
            if (fall < 1.0 && fall > -1.0) {
                mStable += 1;
                if (mStable >= 5) { mPhase = PH_LANDED; mLandedT = t; }
            } else { mStable = 0; }
        }

        if (mPhase != prev) { vibrate(mPhase == PH_FREEFALL ? 3 : 1); }
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

    // ---------------------------------------------------------- upload
    function buildPayload() as Dictionary {
        return {
            "schema" => "skydive.v1",
            "source" => "live",
            "device" => "venu3",
            "startTime" => mStartSec,
            "summary" => {
                "exitAltitude" => mExitAlt,
                "freefallTime" => getFreefallTime(),
                "canopyTime" => getCanopyTime(),
                "peakVerticalSpeed" => mPeakFall,
                "peakHr" => mPeakHr
            },
            "series" => {
                "t" => mT, "alt" => mAlt, "hr" => mHr,
                "lat" => mLat, "lng" => mLng, "ph" => mPh
            }
        };
    }

    function uploadJump() as Void {
        mUploader = new Uploader();
        mUploader.setStatusHandler(method(:onUploadStatus));
        mUploader.enqueue(buildPayload());
        mPostMsg = "Versturen...";
        mUploader.flush();
    }

    function onUploadStatus(success as Boolean, pending as Number) as Void {
        if (success && pending == 0) {
            mPostMsg = "Verstuurd ✓";
        } else if (success) {
            mPostMsg = "Verstuurd ✓ (" + pending + " in wachtrij)";
        } else {
            mPostMsg = pending + " in wachtrij — opnieuw bij verbinding. FIT bewaard.";
        }
        WatchUi.requestUpdate();
    }
}
