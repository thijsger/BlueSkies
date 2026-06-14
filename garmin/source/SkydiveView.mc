import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Position;
import Toybox.Math;
import Toybox.Timer;
import Toybox.Lang;

// On-watch UI. Idle: a "ready" screen (GPS/HR/queue). Recording: an animated
// scene per phase (jumper in the plane, exit, freefall star with wind streaks,
// hanging under canopy, landed) plus compact live stats. A ~15 fps animation
// timer runs only while recording.
class SkydiveView extends WatchUi.View {

    // mirror JumpRecorder phase codes
    const CLIMB = 0;
    const EXIT = 1;
    const FREEFALL = 2;
    const CANOPY = 3;
    const LANDED = 4;

    var mRecorder as JumpRecorder;
    var mStopArmed as Boolean = false;
    var mAnimTimer as Timer.Timer? = null;
    var mFrame as Number = 0;

    // demo mode: auto-cycle every phase so the animations are viewable without jumping
    var mDemo as Boolean = false;
    var mDemoPhase as Number = 0;
    var mDemoTimer as Timer.Timer? = null;

    function startDemo() as Void {
        if (mRecorder.isRecording()) { return; }
        mDemo = true;
        mDemoPhase = CLIMB;
        ensureAnim();
        if (mDemoTimer != null) { mDemoTimer.stop(); }
        mDemoTimer = new Timer.Timer();
        mDemoTimer.start(method(:onDemoTick), 3500, true);
        WatchUi.requestUpdate();
    }
    function onDemoTick() as Void {
        mDemoPhase += 1;
        if (mDemoPhase > LANDED) { stopDemo(); }
        else { WatchUi.requestUpdate(); }
    }
    function stopDemo() as Void {
        mDemo = false;
        if (mDemoTimer != null) { mDemoTimer.stop(); mDemoTimer = null; }
        if (!mRecorder.isRecording()) { stopAnim(); }
        WatchUi.requestUpdate();
    }

    function initialize() {
        View.initialize();
        mRecorder = new JumpRecorder();
    }

    function getRecorder() as JumpRecorder { return mRecorder; }

    function onShow() as Void {
        if (!mRecorder.isRecording()) { mRecorder.startIdle(); }
    }
    function onHide() as Void {
        mRecorder.stopIdle();
        stopAnim();
    }

    function ensureAnim() as Void {
        if (mAnimTimer == null) {
            mAnimTimer = new Timer.Timer();
            mAnimTimer.start(method(:onAnimTick), 67, true); // ~15 fps
        }
    }
    function stopAnim() as Void {
        if (mAnimTimer != null) { mAnimTimer.stop(); mAnimTimer = null; }
    }
    function onAnimTick() as Void { mFrame += 1; WatchUi.requestUpdate(); }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();
        if (mDemo) {
            ensureAnim();
            drawScene(dc, w, h, mDemoPhase, true);
        } else if (mRecorder.isRecording()) {
            ensureAnim();
            drawScene(dc, w, h, mRecorder.getPhase(), false);
        } else {
            stopAnim();
            drawIdle(dc, w, h);
        }
    }

    function labelFor(ph as Number) as String {
        if (ph == CLIMB) { return "KLIM"; }
        if (ph == EXIT) { return "EXIT"; }
        if (ph == FREEFALL) { return "VRIJE VAL"; }
        if (ph == CANOPY) { return "CANOPY"; }
        return "GELAND";
    }
    function colorFor(ph as Number) as Number {
        if (ph == CLIMB) { return 0x4F8DFF; }
        if (ph == EXIT) { return 0xF6A23B; }
        if (ph == FREEFALL) { return 0xF43F6E; }
        if (ph == CANOPY) { return 0x10D68A; }
        return 0x8A93A8;
    }

    // ---------------------------------------------------------- idle
    function drawIdle(dc as Graphics.Dc, w as Number, h as Number) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.16, Graphics.FONT_MEDIUM, "BlueSkies", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.32, Graphics.FONT_XTINY, "Klaar om op te nemen", Graphics.TEXT_JUSTIFY_CENTER);

        var q = mRecorder.getGpsQuality();
        var gpsColor = Graphics.COLOR_RED;
        var gpsTxt = "GPS zoeken...";
        if (q >= 4) { gpsColor = Graphics.COLOR_GREEN; gpsTxt = "GPS klaar"; }
        else if (q == 3) { gpsColor = Graphics.COLOR_GREEN; gpsTxt = "GPS goed"; }
        else if (q == 2) { gpsColor = Graphics.COLOR_YELLOW; gpsTxt = "GPS zwak"; }
        else if (q == 1) { gpsColor = Graphics.COLOR_YELLOW; gpsTxt = "GPS laatste fix"; }
        dc.setColor(gpsColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.46, Graphics.FONT_SMALL, gpsTxt, Graphics.TEXT_JUSTIFY_CENTER);

        var hr = mRecorder.getIdleHr();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.60, Graphics.FONT_XTINY, (hr == null) ? "HR --" : "HR " + hr.format("%d"), Graphics.TEXT_JUSTIFY_CENTER);

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
        dc.drawText(w / 2, h * 0.83, Graphics.FONT_XTINY, "Tik = start", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.91, Graphics.FONT_XTINY, "Hou vast = demo", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // ---------------------------------------------------------- recording / demo
    function drawScene(dc as Graphics.Dc, w as Number, h as Number, ph as Number, isDemo as Boolean) as Void {
        var cx = w / 2.0;
        var cy = h * 0.40;
        var u = w / 22.0;

        dc.setColor(colorFor(ph), Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.07, Graphics.FONT_TINY, labelFor(ph) + (isDemo ? "  (demo)" : ""), Graphics.TEXT_JUSTIFY_CENTER);

        if (ph == CLIMB) { sceneClimb(dc, cx, cy, u); }
        else if (ph == EXIT) { sceneExit(dc, cx, cy, u); }
        else if (ph == FREEFALL) { sceneFreefall(dc, cx, cy, u, h); }
        else if (ph == CANOPY) { sceneCanopy(dc, cx, cy, u); }
        else { sceneLanded(dc, cx, cy, u); }

        // compact stats
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var altTxt; var hrTxt; var ffTxt;
        if (isDemo) {
            var demoAlt = [3500, 4000, 2200, 700, 0];
            altTxt = demoAlt[ph].toString() + " m";
            hrTxt = "150 bpm";
            ffTxt = (ph >= FREEFALL) ? "VV 12s" : "VV 0s";
        } else {
            var alt = mRecorder.getCurrentAlt();
            altTxt = (alt == null) ? "-- m" : alt.format("%d") + " m";
            var hr = mRecorder.getCurrentHr();
            hrTxt = (hr == null) ? "-- bpm" : hr.format("%d") + " bpm";
            ffTxt = "VV " + mRecorder.getFreefallTime().format("%d") + "s";
        }
        dc.drawText(w * 0.30, h * 0.74, Graphics.FONT_XTINY, altTxt, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w * 0.70, h * 0.74, Graphics.FONT_XTINY, hrTxt, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, h * 0.80, Graphics.FONT_XTINY, ffTxt, Graphics.TEXT_JUSTIFY_CENTER);

        if (isDemo) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.90, Graphics.FONT_XTINY, "Tik = stop demo", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (mStopArmed) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.90, Graphics.FONT_XTINY, "Tik nogmaals om te stoppen", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.90, Graphics.FONT_XTINY, "Tik = stop", Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // ---------------------------------------------------------- scenes
    function sceneClimb(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var drift = Math.sin(mFrame * 0.05) * (u * 1.2);
        var bob = Math.sin(mFrame * 0.05) * (u * 0.18);
        var px = cx + drift;
        var py = cy + bob;

        // climb path (dots up-right)
        dc.setColor(0x4F8DFF, Graphics.COLOR_TRANSPARENT);
        for (var i = 1; i <= 5; i++) {
            dc.fillCircle((px - i * 0.9 * u).toNumber(), (py + i * 0.55 * u).toNumber(), (u * 0.1).toNumber());
        }

        // plane body (side view, nose up-right)
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var body = [
            pt(px - 2.0 * u, py + 0.5 * u), pt(px + 1.6 * u, py - 0.5 * u),
            pt(px + 2.2 * u, py - 0.35 * u), pt(px + 1.7 * u, py + 0.05 * u),
            pt(px - 1.7 * u, py + 1.0 * u)
        ];
        dc.fillPolygon(body);
        // tail fin
        dc.fillPolygon([pt(px - 1.9 * u, py + 0.55 * u), pt(px - 2.3 * u, py - 0.2 * u), pt(px - 1.4 * u, py + 0.45 * u)]);
        // wing
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([pt(px - 0.2 * u, py + 0.2 * u), pt(px + 0.6 * u, py + 0.1 * u), pt(px - 0.3 * u, py + 1.1 * u), pt(px - 1.0 * u, py + 1.0 * u)]);
        // window with jumper inside (blue dot)
        dc.setColor(0x4F8DFF, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle((px + 0.4 * u).toNumber(), (py - 0.05 * u).toNumber(), (u * 0.22).toNumber());
    }

    function sceneExit(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        // small plane top-left
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var px = cx - 2.0 * u;
        var py = cy - 2.2 * u;
        dc.fillPolygon([pt(px - 1.2 * u, py + 0.3 * u), pt(px + 1.0 * u, py - 0.2 * u), pt(px + 1.4 * u, py), pt(px - 1.0 * u, py + 0.6 * u)]);
        // tumbling jumper falling away (rotation via swinging limbs)
        var sw = Math.sin(mFrame * 0.5);
        var fx = cx + 0.6 * u;
        var fy = cy + 0.4 * u;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.16));
        dc.fillCircle(fx.toNumber(), (fy - 1.1 * u).toNumber(), (u * 0.42).toNumber());
        ln(dc, fx, fy - 0.7 * u, fx, fy + 0.5 * u);
        ln(dc, fx, fy - 0.4 * u, fx - 1.1 * u, fy - 0.4 * u + sw * u);
        ln(dc, fx, fy - 0.4 * u, fx + 1.1 * u, fy - 0.4 * u - sw * u);
        ln(dc, fx, fy + 0.5 * u, fx - 0.7 * u, fy + 1.4 * u - sw * 0.6 * u);
        ln(dc, fx, fy + 0.5 * u, fx + 0.7 * u, fy + 1.4 * u + sw * 0.6 * u);
    }

    function sceneFreefall(dc as Graphics.Dc, cx as Float, cy as Float, u as Float, h as Number) as Void {
        // upward-rushing wind streaks (speed)
        dc.setColor(0x3A5170, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.12));
        var span = h * 0.5;
        for (var i = 0; i < 7; i++) {
            var sx = cx + (i - 3) * 1.05 * u;
            var off = ((mFrame * 9 + i * 47) % span.toNumber());
            var sy = cy + 2.0 * u - off;
            ln(dc, sx, sy, sx, sy - 0.7 * u);
        }

        // jumper in a stable star/box (belly to earth, from behind)
        var fl = Math.sin(mFrame * 0.45) * (u * 0.14); // limb flutter
        var bob = Math.sin(mFrame * 0.3) * (u * 0.12);
        var fx = cx;
        var fy = cy + bob;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.2));
        dc.fillCircle(fx.toNumber(), (fy - 1.3 * u).toNumber(), (u * 0.5).toNumber());
        ln(dc, fx, fy - 0.85 * u, fx, fy + 0.45 * u);                 // torso
        ln(dc, fx, fy - 0.7 * u, fx - 1.35 * u, fy - 1.35 * u - fl);  // arms up-out
        ln(dc, fx, fy - 0.7 * u, fx + 1.35 * u, fy - 1.35 * u + fl);
        ln(dc, fx, fy + 0.45 * u, fx - 0.95 * u, fy + 1.55 * u + fl); // legs down-out
        ln(dc, fx, fy + 0.45 * u, fx + 0.95 * u, fy + 1.55 * u - fl);
    }

    function sceneCanopy(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var sway = Math.sin(mFrame * 0.09) * (u * 0.9);
        var ccx = cx + sway * 0.5;
        var ccy = cy - 1.9 * u;
        var fcx = cx + sway;

        // canopy dome (filled, phase green)
        dc.setColor(0x10D68A, Graphics.COLOR_TRANSPARENT);
        var dome = [];
        var n = 12;
        for (var i = 0; i <= n; i++) {
            var a = Math.PI * i / n;
            dome.add(pt(ccx - Math.cos(a) * 1.9 * u, ccy - Math.sin(a) * 1.0 * u));
        }
        dome.add(pt(ccx + 1.9 * u, ccy + 0.15 * u));
        dome.add(pt(ccx - 1.9 * u, ccy + 0.15 * u));
        dc.fillPolygon(dome);

        // lines to risers
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.06));
        ln(dc, ccx - 1.7 * u, ccy + 0.1 * u, fcx - 0.3 * u, cy - 0.1 * u);
        ln(dc, ccx - 0.55 * u, ccy + 0.1 * u, fcx - 0.15 * u, cy - 0.1 * u);
        ln(dc, ccx + 0.55 * u, ccy + 0.1 * u, fcx + 0.15 * u, cy - 0.1 * u);
        ln(dc, ccx + 1.7 * u, ccy + 0.1 * u, fcx + 0.3 * u, cy - 0.1 * u);

        // hanging jumper
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.18));
        dc.fillCircle(fcx.toNumber(), (cy + 0.15 * u).toNumber(), (u * 0.4).toNumber());
        ln(dc, fcx, cy + 0.45 * u, fcx, cy + 1.4 * u);                // torso
        ln(dc, fcx, cy + 0.55 * u, fcx - 0.35 * u, cy - 0.1 * u);     // arms up to risers
        ln(dc, fcx, cy + 0.55 * u, fcx + 0.35 * u, cy - 0.1 * u);
        ln(dc, fcx, cy + 1.4 * u, fcx - 0.3 * u, cy + 2.1 * u);       // legs
        ln(dc, fcx, cy + 1.4 * u, fcx + 0.3 * u, cy + 2.1 * u);
    }

    function sceneLanded(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var gy = cy + 1.9 * u;
        // ground
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.12));
        ln(dc, cx - 3.2 * u, gy, cx + 3.2 * u, gy);

        // collapsed canopy draped on the ground (right)
        dc.setColor(0x10D68A, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([pt(cx + 0.8 * u, gy), pt(cx + 1.4 * u, gy - 0.5 * u), pt(cx + 2.2 * u, gy - 0.3 * u), pt(cx + 3.0 * u, gy)]);

        // standing jumper (left), gentle idle sway
        var s = Math.sin(mFrame * 0.08) * (u * 0.05);
        var fx = cx - 1.3 * u + s;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.18));
        dc.fillCircle(fx.toNumber(), (gy - 2.4 * u).toNumber(), (u * 0.4).toNumber());
        ln(dc, fx, gy - 2.0 * u, fx, gy - 0.9 * u);          // torso
        ln(dc, fx, gy - 1.7 * u, fx - 0.5 * u, gy - 1.1 * u); // arms
        ln(dc, fx, gy - 1.7 * u, fx + 0.5 * u, gy - 1.1 * u);
        ln(dc, fx, gy - 0.9 * u, fx - 0.45 * u, gy);          // legs
        ln(dc, fx, gy - 0.9 * u, fx + 0.45 * u, gy);
    }

    // ---------------------------------------------------------- draw helpers
    function ln(dc as Graphics.Dc, x1 as Float, y1 as Float, x2 as Float, y2 as Float) as Void {
        dc.drawLine(x1.toNumber(), y1.toNumber(), x2.toNumber(), y2.toNumber());
    }
    function pt(x as Float, y as Float) as Array {
        return [x.toNumber(), y.toNumber()];
    }
    function maxw(v as Float) as Number {
        var n = v.toNumber();
        return (n < 2) ? 2 : n;
    }
}
