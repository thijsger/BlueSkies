import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Application;
import Toybox.Lang;

// First-launch safety/legal disclaimer. Must be accepted once.
class DisclaimerView extends WatchUi.View {

    function initialize() {
        View.initialize();
    }

    function splitPipe(s as Lang.String) as Lang.Array {
        var out = [];
        var rest = s;
        var idx = rest.find("|");
        while (idx != null) {
            out.add(rest.substring(0, idx));
            rest = rest.substring(idx + 1, rest.length());
            idx = rest.find("|");
        }
        out.add(rest);
        return out;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();

        // localized disclaimer: lines separated by "|"
        var lines = splitPipe(WatchUi.loadResource(Rez.Strings.Disclaimer) as String);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.10, Graphics.FONT_TINY, lines[0], Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var y = h * 0.24;
        for (var i = 1; i < lines.size(); i++) {
            dc.drawText(w / 2, y, Graphics.FONT_XTINY, lines[i], Graphics.TEXT_JUSTIFY_CENTER);
            y += h * 0.10;
        }
    }
}

class DisclaimerDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onTap(evt as WatchUi.ClickEvent) as Lang.Boolean {
        return accept();
    }

    function onSelect() as Lang.Boolean {
        return accept();
    }

    function accept() as Lang.Boolean {
        Application.Storage.setValue("disclaimerAccepted", true);
        var view = new SkydiveView();
        WatchUi.switchToView(view, new SkydiveDelegate(view), WatchUi.SLIDE_IMMEDIATE);
        return true;
    }
}
