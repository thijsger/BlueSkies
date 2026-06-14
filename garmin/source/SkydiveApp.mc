import Toybox.Application;
import Toybox.WatchUi;
import Toybox.Lang;

// Entry point. Shows the safety disclaimer on first launch, then the main view.
class SkydiveApp extends Application.AppBase {

    var mUploader as Uploader? = null;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {
        // Retry any jumps that couldn't be sent earlier (offline at the DZ).
        mUploader = new Uploader();
        mUploader.flush();
    }

    function onStop(state as Dictionary?) as Void {}

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        var accepted = Application.Storage.getValue("disclaimerAccepted");
        if (accepted == null || accepted == false) {
            return [ new DisclaimerView(), new DisclaimerDelegate() ];
        }
        var view = new SkydiveView();
        return [ view, new SkydiveDelegate(view) ];
    }
}
