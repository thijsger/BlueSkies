import Toybox.WatchUi;
import Toybox.Lang;

// Tap or SELECT toggles recording. On stop, shows the summary screen.
class SkydiveDelegate extends WatchUi.BehaviorDelegate {

    var mView as SkydiveView;

    function initialize(view as SkydiveView) {
        BehaviorDelegate.initialize();
        mView = view;
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        return toggle();
    }

    function onSelect() as Lang.Boolean {
        return toggle();
    }

    function toggle() as Lang.Boolean {
        var rec = mView.getRecorder();
        if (rec.isRecording()) {
            rec.stop();
            WatchUi.pushView(new SummaryView(rec), new SummaryDelegate(), WatchUi.SLIDE_UP);
        } else {
            rec.start();
        }
        WatchUi.requestUpdate();
        return true;
    }
}
