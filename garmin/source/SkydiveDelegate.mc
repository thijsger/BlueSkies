import Toybox.WatchUi;
import Toybox.Timer;
import Toybox.Attention;
import Toybox.Lang;

// Tap/SELECT starts a recording. While recording, a first tap "arms" the stop
// (confirm-to-stop guard against accidental taps); a second tap within 3 s
// actually stops. Auto-stop after landing routes through the same onStopped.
class SkydiveDelegate extends WatchUi.BehaviorDelegate {

    var mView as SkydiveView;
    var mArmTimer as Timer.Timer? = null;

    function initialize(view as SkydiveView) {
        BehaviorDelegate.initialize();
        mView = view;
        mView.getRecorder().setStoppedHandler(method(:onStopped));
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean { return toggle(); }
    function onSelect() as Lang.Boolean { return toggle(); }

    // long-press or menu starts the animation demo (when not recording)
    function onHold(evt as WatchUi.ClickEvent) as Lang.Boolean { return startDemo(); }
    function onMenu() as Lang.Boolean { return startDemo(); }

    function startDemo() as Lang.Boolean {
        if (!mView.getRecorder().isRecording() && !mView.mDemo) {
            mView.startDemo();
        }
        return true;
    }

    function toggle() as Lang.Boolean {
        // a tap during the demo just stops it
        if (mView.mDemo) { mView.stopDemo(); return true; }

        var rec = mView.getRecorder();
        if (rec.isRecording()) {
            if (mView.mStopArmed) {
                disarm();
                rec.stop(); // -> onStopped pushes the summary
            } else {
                arm();
            }
        } else {
            rec.start();
        }
        WatchUi.requestUpdate();
        return true;
    }

    function arm() as Void {
        mView.mStopArmed = true;
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(50, 120)]);
        }
        if (mArmTimer != null) { mArmTimer.stop(); }
        mArmTimer = new Timer.Timer();
        mArmTimer.start(method(:onDisarm), 3000, false);
    }

    function disarm() as Void {
        mView.mStopArmed = false;
        if (mArmTimer != null) { mArmTimer.stop(); mArmTimer = null; }
    }

    function onDisarm() as Void {
        mView.mStopArmed = false;
        mArmTimer = null;
        WatchUi.requestUpdate();
    }

    function onStopped() as Void {
        mView.mStopArmed = false;
        var rec = mView.getRecorder();
        WatchUi.pushView(new SummaryView(rec), new SummaryDelegate(), WatchUi.SLIDE_UP);
    }
}
