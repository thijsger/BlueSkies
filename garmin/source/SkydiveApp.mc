import Toybox.Application;
import Toybox.WatchUi;
import Toybox.Lang;

// Entry point. Shows the safety disclaimer on first launch, then the main view.
class SkydiveApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {}

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
