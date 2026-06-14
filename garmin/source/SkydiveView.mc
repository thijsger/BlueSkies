import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;

// Minimal on-watch UI: idle screen + live phase/stats while recording.
class SkydiveView extends WatchUi.View {

    var mRecorder as JumpRecorder;

    function initialize() {
        View.initialize();
        mRecorder = new JumpRecorder();
    }

    function getRecorder() as JumpRecorder {
        return mRecorder;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();

        if (mRecorder.isRecording()) {
            drawRecording(dc, w, h);
        } else {
            drawIdle(dc, w, h);
        }
    }

    function drawIdle(dc as Graphics.Dc, w as Number, h as Number) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.30, Graphics.FONT_MEDIUM, "Skydive Log", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.50, Graphics.FONT_SMALL, "Tik = start", Graphics.TEXT_JUSTIFY_CENTER);
        if (!mRecorder.hasBaro()) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.66, Graphics.FONT_XTINY, "Geen barometer", Graphics.TEXT_JUSTIFY_CENTER);
        }
        var msg = mRecorder.getPostMessage();
        if (msg.length() > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.80, Graphics.FONT_XTINY, msg, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    function drawRecording(dc as Graphics.Dc, w as Number, h as Number) as Void {
        // big phase label
        dc.setColor(mRecorder.getPhaseColor(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.18, Graphics.FONT_MEDIUM, mRecorder.getPhaseLabel(), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        var alt = mRecorder.getCurrentAlt();
        var altTxt = (alt == null) ? "alt --" : "alt " + alt.format("%d") + " m";
        dc.drawText(w / 2, h * 0.40, Graphics.FONT_SMALL, altTxt, Graphics.TEXT_JUSTIFY_CENTER);

        var hr = mRecorder.getCurrentHr();
        var hrTxt = (hr == null) ? "HR --" : "HR " + hr.format("%d");
        dc.drawText(w / 2, h * 0.53, Graphics.FONT_SMALL, hrTxt, Graphics.TEXT_JUSTIFY_CENTER);

        var ff = mRecorder.getFreefallTime();
        dc.drawText(w / 2, h * 0.66, Graphics.FONT_SMALL, "FF " + ff.format("%d") + "s", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.84, Graphics.FONT_XTINY, "Tik = stop", Graphics.TEXT_JUSTIFY_CENTER);
    }
}
