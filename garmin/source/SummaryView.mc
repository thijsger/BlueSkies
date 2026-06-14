import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;

// Post-jump summary. Values from freefall are explicitly labelled as estimates.
class SummaryView extends WatchUi.View {

    var mRec as JumpRecorder;

    function initialize(rec as JumpRecorder) {
        View.initialize();
        mRec = rec;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.10, Graphics.FONT_SMALL, "Samenvatting", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var y = h * 0.26;
        var step = h * 0.105;

        var exit = mRec.getExitAlt();
        var exitTxt = (exit == null) ? "--" : exit.format("%d") + " m";
        line(dc, w, y, "Exit (schat)", exitTxt); y += step;

        line(dc, w, y, "Vrije val", mRec.getFreefallTime().format("%d") + " s"); y += step;
        line(dc, w, y, "Canopy", mRec.getCanopyTime().format("%d") + " s"); y += step;

        var pf = mRec.getPeakFall();
        line(dc, w, y, "Piek VS (schat)", pf.format("%.0f") + " m/s"); y += step;
        line(dc, w, y, "Piek HR", mRec.getPeakHr().format("%d")); y += step;

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var msg = mRec.getPostMessage();
        dc.drawText(w / 2, h * 0.88, Graphics.FONT_XTINY,
            msg.length() > 0 ? msg : "Tik om te sluiten", Graphics.TEXT_JUSTIFY_CENTER);
    }

    function line(dc as Graphics.Dc, w as Number, y as Float, label as String, value as String) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.06, y, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.94, y, Graphics.FONT_XTINY, value, Graphics.TEXT_JUSTIFY_RIGHT);
    }
}

class SummaryDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onSelect() as Lang.Boolean {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onBack() as Lang.Boolean {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
