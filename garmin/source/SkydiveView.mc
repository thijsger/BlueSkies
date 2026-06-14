import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Position;
import Toybox.Lang;

// On-watch UI: a "ready" screen (GPS/HR/queue status) when idle, and live
// phase/stats while recording. mStopArmed shows the confirm-to-stop hint.
class SkydiveView extends WatchUi.View {

    var mRecorder as JumpRecorder;
    var mStopArmed as Boolean = false;

    function initialize() {
        View.initialize();
        mRecorder = new JumpRecorder();
    }

    function getRecorder() as JumpRecorder { return mRecorder; }

    function onShow() as Void {
        if (!mRecorder.isRecording()) { mRecorder.startIdle(); }
    }
    function onHide() as Void { mRecorder.stopIdle(); }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();
        if (mRecorder.isRecording()) { drawRecording(dc, w, h); }
        else { drawIdle(dc, w, h); }
    }

    function drawIdle(dc as Graphics.Dc, w as Number, h as Number) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.16, Graphics.FONT_MEDIUM, "BlueSkies", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.32, Graphics.FONT_XTINY, "Klaar om op te nemen", Graphics.TEXT_JUSTIFY_CENTER);

        // GPS readiness
        var q = mRecorder.getGpsQuality();
        var gpsColor = Graphics.COLOR_RED;
        var gpsTxt = "GPS zoeken...";
        if (q >= 4) { gpsColor = Graphics.COLOR_GREEN; gpsTxt = "GPS klaar"; }
        else if (q == 3) { gpsColor = Graphics.COLOR_GREEN; gpsTxt = "GPS goed"; }
        else if (q == 2) { gpsColor = Graphics.COLOR_YELLOW; gpsTxt = "GPS zwak"; }
        else if (q == 1) { gpsColor = Graphics.COLOR_YELLOW; gpsTxt = "GPS laatste fix"; }
        if (!mRecorder.hasBaro()) { /* baro-less device */ }
        dc.setColor(gpsColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.46, Graphics.FONT_SMALL, gpsTxt, Graphics.TEXT_JUSTIFY_CENTER);

        // HR readiness
        var hr = mRecorder.getIdleHr();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var hrTxt = (hr == null) ? "HR --" : "HR " + hr.format("%d");
        dc.drawText(w / 2, h * 0.60, Graphics.FONT_XTINY, hrTxt, Graphics.TEXT_JUSTIFY_CENTER);

        // queued uploads + last status
        var pending = mRecorder.getPendingUploads();
        var msg = mRecorder.getPostMessage();
        if (pending > 0) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.72, Graphics.FONT_XTINY, pending + " in wachtrij", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (msg.length() > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.72, Graphics.FONT_XTINY, msg, Graphics.TEXT_JUSTIFY_CENTER);
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.85, Graphics.FONT_XTINY, "Tik = start", Graphics.TEXT_JUSTIFY_CENTER);
    }

    function drawRecording(dc as Graphics.Dc, w as Number, h as Number) as Void {
        dc.setColor(mRecorder.getPhaseColor(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.16, Graphics.FONT_MEDIUM, mRecorder.getPhaseLabel(), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var alt = mRecorder.getCurrentAlt();
        var altTxt = (alt == null) ? "alt --" : "alt " + alt.format("%d") + " m";
        dc.drawText(w / 2, h * 0.38, Graphics.FONT_SMALL, altTxt, Graphics.TEXT_JUSTIFY_CENTER);

        var hr = mRecorder.getCurrentHr();
        var hrTxt = (hr == null) ? "HR --" : "HR " + hr.format("%d");
        dc.drawText(w / 2, h * 0.50, Graphics.FONT_SMALL, hrTxt, Graphics.TEXT_JUSTIFY_CENTER);

        dc.drawText(w / 2, h * 0.62, Graphics.FONT_SMALL, "FF " + mRecorder.getFreefallTime().format("%d") + "s", Graphics.TEXT_JUSTIFY_CENTER);

        if (mStopArmed) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.84, Graphics.FONT_XTINY, "Tik nogmaals om te stoppen", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.84, Graphics.FONT_XTINY, "Tik = stop", Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}
