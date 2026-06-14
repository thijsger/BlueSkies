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

    // realistic jumper palette (consistent person across phases)
    const SUIT = 0xE0584F;
    const SUIT_D = 0xA23A37;
    const HELM = 0x20242E;
    const HELM_HI = 0x3A4254;
    const VISOR = 0x8FB6FF;
    const DARK = 0x14171F;
    const RIG = 0x2A2F3A;

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
    // jp: map a local (lx,ly) in body-units onto screen, scaled by uss and rotated ca/sa
    function jp(ox as Float, oy as Float, lx as Float, ly as Float, uss as Float, ca as Float, sa as Float) as Array {
        return [(ox + (lx * uss) * ca - (ly * uss) * sa).toNumber(), (oy + (lx * uss) * sa + (ly * uss) * ca).toNumber()];
    }
    // capsule limb: thick line + rounded joints
    function cap(dc as Graphics.Dc, p1 as Array, p2 as Array, w as Float, col as Number) as Void {
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(w));
        dc.drawLine(p1[0], p1[1], p2[0], p2[1]);
        var r = maxw(w / 2);
        dc.fillCircle(p1[0], p1[1], r);
        dc.fillCircle(p2[0], p2[1], r);
    }

    // A detailed jump plane centred at px,py, tilted ca/sa, scaled by s (units of u).
    function plane(dc as Graphics.Dc, px as Float, py as Float, u as Float, ca as Float, sa as Float, s as Float) as Void {
        var uss = u * s;
        var hub = rp(px, py, 3.3 * uss, -0.04 * uss, ca, sa);
        // prop blur disc
        dc.setColor(0x1E2B40, Graphics.COLOR_TRANSPARENT);
        dc.fillEllipse(hub[0], hub[1], maxw(uss * 0.4), maxw(uss * 1.25));
        // fuselage
        dc.setColor(0xCFD6E3, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            rp(px, py, -3.1 * uss, 0.28 * uss, ca, sa), rp(px, py, -2.7 * uss, -0.5 * uss, ca, sa),
            rp(px, py, 2.2 * uss, -0.66 * uss, ca, sa), rp(px, py, 3.05 * uss, -0.32 * uss, ca, sa),
            rp(px, py, 3.3 * uss, -0.04 * uss, ca, sa), rp(px, py, 3.1 * uss, 0.22 * uss, ca, sa),
            rp(px, py, 2.4 * uss, 0.66 * uss, ca, sa), rp(px, py, -2.7 * uss, 0.66 * uss, ca, sa)
        ]);
        // top highlight + belly shade
        dc.setColor(0xEEF2FA, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([rp(px, py, -2.7 * uss, -0.5 * uss, ca, sa), rp(px, py, 2.2 * uss, -0.66 * uss, ca, sa), rp(px, py, 2.6 * uss, -0.4 * uss, ca, sa), rp(px, py, -2.6 * uss, -0.24 * uss, ca, sa)]);
        dc.setColor(0x9AA6BA, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([rp(px, py, -2.7 * uss, 0.66 * uss, ca, sa), rp(px, py, 2.4 * uss, 0.66 * uss, ca, sa), rp(px, py, 2.7 * uss, 0.4 * uss, ca, sa), rp(px, py, -2.6 * uss, 0.42 * uss, ca, sa)]);
        // brand stripe
        dc.setColor(0x4F8DFF, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([rp(px, py, -2.5 * uss, 0.12 * uss, ca, sa), rp(px, py, 2.3 * uss, 0.0, ca, sa), rp(px, py, 2.35 * uss, 0.2 * uss, ca, sa), rp(px, py, -2.5 * uss, 0.3 * uss, ca, sa)]);
        // cockpit window
        dc.setColor(0x0A1426, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([rp(px, py, 2.35 * uss, -0.5 * uss, ca, sa), rp(px, py, 3.05 * uss, -0.18 * uss, ca, sa), rp(px, py, 3.0 * uss, 0.08 * uss, ca, sa), rp(px, py, 2.4 * uss, 0.0, ca, sa)]);
        // cabin windows
        dc.setColor(0x9CC2F2, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < 5; i++) {
            var q = rp(px, py, (1.5 - i * 0.78) * uss, -0.2 * uss, ca, sa);
            dc.fillCircle(q[0], q[1], maxw(uss * 0.15));
        }
        // tail fin + stabiliser
        dc.setColor(0xCFD6E3, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([rp(px, py, -3.1 * uss, -0.42 * uss, ca, sa), rp(px, py, -2.55 * uss, -1.8 * uss, ca, sa), rp(px, py, -2.05 * uss, -1.8 * uss, ca, sa), rp(px, py, -2.2 * uss, -0.46 * uss, ca, sa)]);
        dc.fillPolygon([rp(px, py, -3.2 * uss, 0.0, ca, sa), rp(px, py, -2.2 * uss, -0.18 * uss, ca, sa), rp(px, py, -2.2 * uss, 0.16 * uss, ca, sa), rp(px, py, -3.2 * uss, 0.22 * uss, ca, sa)]);
        // high wing + strut
        dc.setColor(0xB8C2D3, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([rp(px, py, -1.0 * uss, -0.66 * uss, ca, sa), rp(px, py, 2.3 * uss, -0.84 * uss, ca, sa), rp(px, py, 2.42 * uss, -0.58 * uss, ca, sa), rp(px, py, -0.9 * uss, -0.42 * uss, ca, sa)]);
        dc.setColor(0x9AA6BA, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(uss * 0.08));
        rln(dc, px, py, -0.2 * uss, -0.5 * uss, 0.5 * uss, 0.24 * uss, ca, sa);
        // gear + wheels
        dc.setColor(0x7E8AA0, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(uss * 0.1));
        rln(dc, px, py, 0.4 * uss, 0.62 * uss, 0.4 * uss, 1.2 * uss, ca, sa);
        rln(dc, px, py, -0.6 * uss, 0.62 * uss, -0.6 * uss, 1.2 * uss, ca, sa);
        dc.setColor(0x15181F, Graphics.COLOR_TRANSPARENT);
        var wa = rp(px, py, 0.4 * uss, 1.28 * uss, ca, sa);
        var wb = rp(px, py, -0.6 * uss, 1.28 * uss, ca, sa);
        dc.fillCircle(wa[0], wa[1], maxw(uss * 0.2));
        dc.fillCircle(wb[0], wb[1], maxw(uss * 0.2));
        // prop blades + hub
        dc.setColor(0xDFE6F2, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(uss * 0.1));
        var pa = mFrame * 0.9;
        for (var b = 0; b < 3; b++) {
            var ang = pa + b * 2.094;
            dc.drawLine(hub[0], hub[1], (hub[0] + Math.cos(ang) * uss * 1.2).toNumber(), (hub[1] + Math.sin(ang) * uss * 1.2).toNumber());
        }
        dc.fillCircle(hub[0], hub[1], maxw(uss * 0.13));
    }

    function cloud(dc as Graphics.Dc, x as Float, y as Float, u as Float) as Void {
        dc.setColor(0x1B2B45, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(x.toNumber(), y.toNumber(), maxw(u * 0.95));
        dc.fillCircle((x + u).toNumber(), (y + u * 0.1).toNumber(), maxw(u * 0.75));
        dc.fillCircle((x - u * 0.9).toNumber(), (y + u * 0.15).toNumber(), maxw(u * 0.65));
        dc.fillCircle((x + u * 0.2).toNumber(), (y - u * 0.45).toNumber(), maxw(u * 0.6));
    }

    // fleshed belly-to-earth jumper, centre fx,fy, rotated rot, scale s
    function jumperFlying(dc as Graphics.Dc, fx as Float, fy as Float, u as Float, rot as Float, s as Float) as Void {
        var ca = Math.cos(rot);
        var sa = Math.sin(rot);
        var uss = u * s;
        var fl = Math.sin(mFrame * 0.4) * 0.12;
        var limb = u * s * 0.42;
        // rig on the back
        dc.setColor(RIG, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([jp(fx, fy, -0.5, -0.8, uss, ca, sa), jp(fx, fy, 0.5, -0.8, uss, ca, sa), jp(fx, fy, 0.55, 0.6, uss, ca, sa), jp(fx, fy, -0.55, 0.6, uss, ca, sa)]);
        // torso jumpsuit + shade
        dc.setColor(SUIT, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([jp(fx, fy, -0.62, -0.9, uss, ca, sa), jp(fx, fy, 0.62, -0.9, uss, ca, sa), jp(fx, fy, 0.5, 0.7, uss, ca, sa), jp(fx, fy, -0.5, 0.7, uss, ca, sa)]);
        dc.setColor(SUIT_D, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([jp(fx, fy, 0.05, -0.9, uss, ca, sa), jp(fx, fy, 0.62, -0.9, uss, ca, sa), jp(fx, fy, 0.5, 0.7, uss, ca, sa), jp(fx, fy, 0.05, 0.7, uss, ca, sa)]);
        // arms
        cap(dc, jp(fx, fy, -0.55, -0.72, uss, ca, sa), jp(fx, fy, -1.45, -1.0 - fl, uss, ca, sa), limb, SUIT);
        cap(dc, jp(fx, fy, -1.45, -1.0 - fl, uss, ca, sa), jp(fx, fy, -1.75, -1.95 - fl, uss, ca, sa), limb * 0.85, SUIT);
        cap(dc, jp(fx, fy, 0.55, -0.72, uss, ca, sa), jp(fx, fy, 1.45, -1.0 + fl, uss, ca, sa), limb, SUIT);
        cap(dc, jp(fx, fy, 1.45, -1.0 + fl, uss, ca, sa), jp(fx, fy, 1.75, -1.95 + fl, uss, ca, sa), limb * 0.85, SUIT);
        dc.setColor(DARK, Graphics.COLOR_TRANSPARENT);
        var gl = jp(fx, fy, -1.75, -1.95 - fl, uss, ca, sa);
        var gr = jp(fx, fy, 1.75, -1.95 + fl, uss, ca, sa);
        dc.fillCircle(gl[0], gl[1], maxw(limb * 0.5));
        dc.fillCircle(gr[0], gr[1], maxw(limb * 0.5));
        // legs
        cap(dc, jp(fx, fy, -0.45, 0.6, uss, ca, sa), jp(fx, fy, -1.2, 1.55 + fl, uss, ca, sa), limb, SUIT);
        cap(dc, jp(fx, fy, -1.2, 1.55 + fl, uss, ca, sa), jp(fx, fy, -0.72, 2.5 + fl, uss, ca, sa), limb * 0.85, SUIT);
        cap(dc, jp(fx, fy, 0.45, 0.6, uss, ca, sa), jp(fx, fy, 1.2, 1.55 - fl, uss, ca, sa), limb, SUIT);
        cap(dc, jp(fx, fy, 1.2, 1.55 - fl, uss, ca, sa), jp(fx, fy, 0.72, 2.5 - fl, uss, ca, sa), limb * 0.85, SUIT);
        dc.setColor(DARK, Graphics.COLOR_TRANSPARENT);
        var bl = jp(fx, fy, -0.72, 2.5 + fl, uss, ca, sa);
        var br = jp(fx, fy, 0.72, 2.5 - fl, uss, ca, sa);
        dc.fillCircle(bl[0], bl[1], maxw(limb * 0.55));
        dc.fillCircle(br[0], br[1], maxw(limb * 0.55));
        // helmet + sheen + visor
        var head = jp(fx, fy, 0.0, -1.45, uss, ca, sa);
        dc.setColor(HELM, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(head[0], head[1], maxw(uss * 0.52));
        dc.setColor(HELM_HI, Graphics.COLOR_TRANSPARENT);
        var sheen = jp(fx, fy, -0.18, -1.6, uss, ca, sa);
        dc.fillCircle(sheen[0], sheen[1], maxw(uss * 0.2));
        dc.setColor(VISOR, Graphics.COLOR_TRANSPARENT);
        var vis = jp(fx, fy, 0.0, -1.55, uss, ca, sa);
        dc.fillEllipse(vis[0], vis[1], maxw(uss * 0.34), maxw(uss * 0.2));
    }

    function sceneClimb(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var bob = Math.sin(mFrame * 0.06) * (u * 0.18);
        var drift = Math.sin(mFrame * 0.03) * (u * 0.6);
        var span = (cx * 2 + u * 4).toNumber();
        cloud(dc, ((mFrame * 7 / 10) % span) - u * 2, cy + u * 2.6, u);
        cloud(dc, ((mFrame * 4 / 10 + (span * 55 / 100)) % span) - u * 2, cy + u * 3.6, u * 0.8);
        var px = cx + drift;
        var py = cy + bob;
        var a = -0.30;
        var ca = Math.cos(a);
        var sa = Math.sin(a);
        dc.setColor(0x355479, Graphics.COLOR_TRANSPARENT);
        for (var i = 1; i <= 6; i++) {
            var q = rp(px, py, (-3.3 - i * 0.7) * u, 0.12 * u, ca, sa);
            dc.fillCircle(q[0], q[1], maxw(u * 0.09));
        }
        plane(dc, px, py, u, ca, sa, 1.0);
        // open door + jumper in the doorway
        dc.setColor(0x0A1426, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([rp(px, py, -1.8 * u, -0.35 * u, ca, sa), rp(px, py, -0.85 * u, -0.4 * u, ca, sa), rp(px, py, -0.85 * u, 0.5 * u, ca, sa), rp(px, py, -1.8 * u, 0.55 * u, ca, sa)]);
        dc.setColor(SUIT, Graphics.COLOR_TRANSPARENT);
        var j = rp(px, py, -1.3 * u, 0.06 * u, ca, sa);
        dc.fillCircle(j[0], j[1], maxw(u * 0.26));
        dc.setColor(HELM, Graphics.COLOR_TRANSPARENT);
        var jh = rp(px, py, -1.05 * u, -0.28 * u, ca, sa);
        dc.fillCircle(jh[0], jh[1], maxw(u * 0.17));
    }

    function sceneExit(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var a = -0.18;
        var ca = Math.cos(a);
        var sa = Math.sin(a);
        var px = cx - 3.5 * u + Math.sin(mFrame * 0.04) * (u * 0.2);
        var py = cy - 3.1 * u;
        plane(dc, px, py, u, ca, sa, 0.6);
        dc.setColor(0x0A1426, Graphics.COLOR_TRANSPARENT);
        var ss = 0.6;
        dc.fillPolygon([rp(px, py, -1.8 * u * ss, -0.35 * u * ss, ca, sa), rp(px, py, -0.85 * u * ss, -0.4 * u * ss, ca, sa), rp(px, py, -0.85 * u * ss, 0.5 * u * ss, ca, sa), rp(px, py, -1.8 * u * ss, 0.55 * u * ss, ca, sa)]);
        // dashed separation arc (door -> jumper)
        dc.setColor(0x7A571E, Graphics.COLOR_TRANSPARENT);
        var ax = px + 0.6 * u;
        var ay = py + 1.0 * u;
        var bx = cx + 0.2 * u;
        var by = cy + 0.4 * u;
        var qx = cx - 1.2 * u;
        var qy = cy - 0.6 * u;
        for (var k = 0; k <= 8; k++) {
            if (k % 2 == 0) {
                var t = k / 8.0;
                dc.fillCircle(qbx(ax, qx, bx, t).toNumber(), qby(ay, qy, by, t).toNumber(), maxw(u * 0.07));
            }
        }
        // relative-wind streaks
        dc.setColor(0x3A5170, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.1));
        var woff = (mFrame % maxw(u)).toFloat();
        for (var i = 0; i < 4; i++) {
            var yy = cy + 1.9 * u + i * 0.5 * u;
            ln(dc, cx + 2.0 * u - woff, yy, cx + 1.1 * u - woff, yy - 0.4 * u);
        }
        // fleshed jumper diving away, rolling into the arch
        var rot = -0.8 + Math.sin(mFrame * 0.16) * 0.45;
        jumperFlying(dc, cx + 0.3 * u, cy + 0.5 * u, u, rot, 0.95);
    }

    function sceneFreefall(dc as Graphics.Dc, cx as Float, cy as Float, u as Float, h as Number) as Void {
        var span = (h * 62 / 100);
        dc.setPenWidth(maxw(u * 0.1));
        for (var i = 0; i < 10; i++) {
            var sx = cx + ((i - 4) * 0.9 - 0.45) * u;
            var off = ((mFrame * 12 + i * 51) % span);
            var sy = cy + 2.6 * u - off;
            dc.setColor(off < span * 0.5 ? 0x6080AA : 0x33455F, Graphics.COLOR_TRANSPARENT);
            ln(dc, sx, sy, sx, sy - 1.1 * u);
        }
        var bob = Math.sin(mFrame * 0.25) * (u * 0.1);
        var yaw = Math.sin(mFrame * 0.12) * 0.07;
        jumperFlying(dc, cx, cy + bob, u, yaw, 1.12);
    }

    function sceneCanopy(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var sway = Math.sin(mFrame * 0.07) * 0.15;
        var ca = Math.cos(sway);
        var sa = Math.sin(sway);
        var ax = cx;
        var ay = cy + 1.4 * u;
        var halfW = 2.8;
        var depth = 0.66;
        var arc = 1.0;
        var wy = -3.4;
        var N = 9;
        var top = [];
        var bot = [];
        for (var i = 0; i <= N; i++) {
            var t = (i.toFloat() / N) * 2 - 1;
            var x = t * halfW;
            var sag = arc * (1 - t * t);
            top.add(rp(ax, ay, x * u, (wy - sag - depth) * u, ca, sa));
            bot.add(rp(ax, ay, x * u, (wy - sag) * u, ca, sa));
        }
        // cells with alternating shade
        for (var i = 0; i < N; i++) {
            dc.setColor((i % 2 == 1) ? 0x0FBF7C : 0x14E093, Graphics.COLOR_TRANSPARENT);
            dc.fillPolygon([top[i], top[i + 1], bot[i + 1], bot[i]]);
        }
        // leading-edge openings (nose notches)
        dc.setColor(0x05281B, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < N; i++) {
            var mx = (bot[i][0] + bot[i + 1][0]) / 2;
            var my = (bot[i][1] + bot[i + 1][1]) / 2;
            dc.fillPolygon([[(mx - u * 0.12).toNumber(), (my + u * 0.02).toNumber()], [(mx + u * 0.12).toNumber(), (my + u * 0.02).toNumber()], [(mx + u * 0.08).toNumber(), (my + u * 0.22).toNumber()], [(mx - u * 0.08).toNumber(), (my + u * 0.22).toNumber()]]);
        }
        // cell ribs
        dc.setColor(0x064B33, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.05));
        for (var i = 0; i <= N; i++) { dc.drawLine(top[i][0], top[i][1], bot[i][0], bot[i][1]); }
        // suspension lines to risers
        var riserL = rp(ax, ay, -0.45 * u, -0.1 * u, ca, sa);
        var riserR = rp(ax, ay, 0.45 * u, -0.1 * u, ca, sa);
        dc.setColor(0xD2DCEB, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        for (var i = 0; i <= N; i++) {
            var tgt = (i <= N / 2) ? riserL : riserR;
            dc.drawLine(bot[i][0], bot[i][1], tgt[0], tgt[1]);
        }
        // slider
        dc.setColor(0x282E3A, Graphics.COLOR_TRANSPARENT);
        var sl = rp(ax, ay, 0.0, -1.4 * u, ca, sa);
        dc.fillPolygon([rp(sl[0], sl[1], -1.3 * u, -0.12 * u, ca, sa), rp(sl[0], sl[1], 1.3 * u, -0.12 * u, ca, sa), rp(sl[0], sl[1], 1.3 * u, 0.12 * u, ca, sa), rp(sl[0], sl[1], -1.3 * u, 0.12 * u, ca, sa)]);
        // jumper in harness
        var uss = u;
        var limb = u * 0.4;
        cap(dc, rp(ax, ay, -0.18 * u, 1.5 * u, ca, sa), rp(ax, ay, -0.4 * u, 2.5 * u, ca, sa), limb, SUIT);
        cap(dc, rp(ax, ay, -0.4 * u, 2.5 * u, ca, sa), rp(ax, ay, -0.3 * u, 3.2 * u, ca, sa), limb * 0.85, SUIT);
        cap(dc, rp(ax, ay, 0.18 * u, 1.5 * u, ca, sa), rp(ax, ay, 0.4 * u, 2.5 * u, ca, sa), limb, SUIT);
        cap(dc, rp(ax, ay, 0.4 * u, 2.5 * u, ca, sa), rp(ax, ay, 0.5 * u, 3.2 * u, ca, sa), limb * 0.85, SUIT);
        dc.setColor(DARK, Graphics.COLOR_TRANSPARENT);
        var bl = rp(ax, ay, -0.3 * u, 3.2 * u, ca, sa);
        var br = rp(ax, ay, 0.5 * u, 3.2 * u, ca, sa);
        dc.fillCircle(bl[0], bl[1], maxw(limb * 0.55));
        dc.fillCircle(br[0], br[1], maxw(limb * 0.55));
        dc.setColor(SUIT, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([rp(ax, ay, -0.55 * u, 0.55 * u, ca, sa), rp(ax, ay, 0.55 * u, 0.55 * u, ca, sa), rp(ax, ay, 0.45 * u, 1.7 * u, ca, sa), rp(ax, ay, -0.45 * u, 1.7 * u, ca, sa)]);
        // arms up to toggles
        cap(dc, rp(ax, ay, -0.5 * u, 0.7 * u, ca, sa), riserL, limb * 0.9, SUIT);
        cap(dc, rp(ax, ay, 0.5 * u, 0.7 * u, ca, sa), riserR, limb * 0.9, SUIT);
        // head + visor
        var head = rp(ax, ay, 0.0, 0.2 * u, ca, sa);
        dc.setColor(HELM, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(head[0], head[1], maxw(u * 0.42));
        dc.setColor(VISOR, Graphics.COLOR_TRANSPARENT);
        var vis = rp(ax, ay, 0.0, 0.12 * u, ca, sa);
        dc.fillEllipse(vis[0], vis[1], maxw(u * 0.3), maxw(u * 0.16));
    }

    function sceneLanded(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var gy = cy + 2.3 * u;
        // ground band
        dc.setColor(0x2C3A22, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(0, gy.toNumber(), (cx * 2).toNumber(), (cy * 3).toNumber());
        dc.setColor(0x4A6234, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.12));
        ln(dc, 0.0, gy, cx * 2, gy);
        dc.setColor(0x3C5530, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.08));
        for (var i = -3; i <= 3; i++) {
            var gx = cx + i * 1.0 * u;
            ln(dc, gx, gy, gx - u * 0.12, gy - u * 0.4);
            ln(dc, gx, gy, gx + u * 0.12, gy - u * 0.4);
        }
        // deflated ram-air canopy crumpled behind
        dc.setColor(0x0FBF7C, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([pt(cx + 0.6 * u, gy), pt(cx + 1.2 * u, gy - 0.6 * u), pt(cx + 1.8 * u, gy - 0.25 * u), pt(cx + 2.4 * u, gy - 0.65 * u), pt(cx + 3.0 * u, gy - 0.2 * u), pt(cx + 3.4 * u, gy)]);
        dc.setColor(0x8893A8, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        ln(dc, cx + 1.2 * u, gy - 0.45 * u, cx - 0.7 * u, gy - 1.05 * u);
        ln(dc, cx + 2.0 * u, gy - 0.4 * u, cx - 0.55 * u, gy - 1.05 * u);
        // standing fleshed jumper (left)
        var sgn = Math.sin(mFrame * 0.06) * (u * 0.04);
        var fx = cx - 1.5 * u + sgn;
        var limb = u * 0.42;
        cap(dc, [(fx - 0.05 * u).toNumber(), (gy - 1.5 * u).toNumber()], [(fx - 0.3 * u).toNumber(), (gy - 0.75 * u).toNumber()], limb, SUIT);
        cap(dc, [(fx - 0.3 * u).toNumber(), (gy - 0.75 * u).toNumber()], [(fx - 0.32 * u).toNumber(), gy.toNumber()], limb * 0.9, SUIT);
        cap(dc, [(fx + 0.05 * u).toNumber(), (gy - 1.5 * u).toNumber()], [(fx + 0.3 * u).toNumber(), (gy - 0.75 * u).toNumber()], limb, SUIT);
        cap(dc, [(fx + 0.3 * u).toNumber(), (gy - 0.75 * u).toNumber()], [(fx + 0.32 * u).toNumber(), gy.toNumber()], limb * 0.9, SUIT);
        dc.setColor(DARK, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle((fx - 0.32 * u).toNumber(), gy.toNumber(), maxw(limb * 0.5));
        dc.fillCircle((fx + 0.32 * u).toNumber(), gy.toNumber(), maxw(limb * 0.5));
        // torso + rig
        dc.setColor(SUIT, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([pt(fx - 0.5 * u, gy - 2.3 * u), pt(fx + 0.5 * u, gy - 2.3 * u), pt(fx + 0.42 * u, gy - 1.45 * u), pt(fx - 0.42 * u, gy - 1.45 * u)]);
        dc.setColor(RIG, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([pt(fx - 0.5 * u, gy - 2.25 * u), pt(fx - 0.72 * u, gy - 2.2 * u), pt(fx - 0.7 * u, gy - 1.5 * u), pt(fx - 0.45 * u, gy - 1.55 * u)]);
        // arms
        cap(dc, [(fx - 0.4 * u).toNumber(), (gy - 2.15 * u).toNumber()], [(fx - 0.7 * u).toNumber(), (gy - 1.6 * u).toNumber()], limb * 0.9, SUIT);
        cap(dc, [(fx - 0.7 * u).toNumber(), (gy - 1.6 * u).toNumber()], [(fx - 0.78 * u).toNumber(), (gy - 1.05 * u).toNumber()], limb * 0.8, SUIT);
        cap(dc, [(fx + 0.4 * u).toNumber(), (gy - 2.15 * u).toNumber()], [(fx + 0.7 * u).toNumber(), (gy - 1.6 * u).toNumber()], limb * 0.9, SUIT);
        cap(dc, [(fx + 0.7 * u).toNumber(), (gy - 1.6 * u).toNumber()], [(fx + 0.78 * u).toNumber(), (gy - 1.05 * u).toNumber()], limb * 0.8, SUIT);
        // head + helmet + visor
        dc.setColor(HELM, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(fx.toNumber(), (gy - 2.7 * u).toNumber(), maxw(u * 0.42));
        dc.setColor(VISOR, Graphics.COLOR_TRANSPARENT);
        dc.fillEllipse(fx.toNumber(), (gy - 2.74 * u).toNumber(), maxw(u * 0.3), maxw(u * 0.16));
    }

    // ---------------------------------------------------------- draw helpers
    function ln(dc as Graphics.Dc, x1 as Float, y1 as Float, x2 as Float, y2 as Float) as Void {
        dc.drawLine(x1.toNumber(), y1.toNumber(), x2.toNumber(), y2.toNumber());
    }
    function pt(x as Float, y as Float) as Array {
        return [x.toNumber(), y.toNumber()];
    }
    // rotate local (lx,ly) around (ox,oy) by ca/sa -> screen point [x,y]
    function rp(ox as Float, oy as Float, lx as Float, ly as Float, ca as Float, sa as Float) as Array {
        return [(ox + lx * ca - ly * sa).toNumber(), (oy + lx * sa + ly * ca).toNumber()];
    }
    // rotated line between two local points
    function rln(dc as Graphics.Dc, ox as Float, oy as Float, x1 as Float, y1 as Float, x2 as Float, y2 as Float, ca as Float, sa as Float) as Void {
        var a = rp(ox, oy, x1, y1, ca, sa);
        var b = rp(ox, oy, x2, y2, ca, sa);
        dc.drawLine(a[0], a[1], b[0], b[1]);
    }
    // quadratic Bézier components (for the exit separation arc)
    function qbx(p0 as Float, p1 as Float, p2 as Float, t as Float) as Float {
        var mt = 1 - t;
        return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
    }
    function qby(p0 as Float, p1 as Float, p2 as Float, t as Float) as Float {
        var mt = 1 - t;
        return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
    }
    function maxw(v as Float) as Number {
        var n = v.toNumber();
        return (n < 1) ? 1 : n;
    }
}
