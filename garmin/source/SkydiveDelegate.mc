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

    // long-press opens the clean phase viewer (showcase) for screenshots
    function onHold(evt as WatchUi.ClickEvent) as Lang.Boolean {
        if (!mView.getRecorder().isRecording()) { mView.startShowcase(); return true; }
        return false;
    }
    function onMenu() as Lang.Boolean {
        if (!mView.getRecorder().isRecording() && !mView.mShowcase) { mView.startShowcase(); return true; }
        return false;
    }

    // swipe left/right between phases in the showcase; swipe down exits
    function onSwipe(swipeEvent as WatchUi.SwipeEvent) as Lang.Boolean {
        if (!mView.mShowcase) { return false; }
        var d = swipeEvent.getDirection();
        if (d == WatchUi.SWIPE_LEFT) { mView.showStep(1); }
        else if (d == WatchUi.SWIPE_RIGHT) { mView.showStep(-1); }
        else if (d == WatchUi.SWIPE_DOWN) { mView.stopShowcase(); }
        return true;
    }

    function toggle() as Lang.Boolean {
        if (mView.mShowcase) { mView.stopShowcase(); return true; } // tap exits showcase
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
