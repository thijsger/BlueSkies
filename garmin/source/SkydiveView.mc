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
        if (mRecorder.isRecording()) {
            ensureAnim();
            drawScene(dc, w, h, mRecorder.getPhase());
        } else {
            stopAnim();
            drawIdle(dc, w, h);
        }
    }

    function labelFor(ph as Number) as String {
        var id = Rez.Strings.PhLanded;
        if (ph == CLIMB) { id = Rez.Strings.PhClimb; }
        else if (ph == EXIT) { id = Rez.Strings.PhExit; }
        else if (ph == FREEFALL) { id = Rez.Strings.PhFreefall; }
        else if (ph == CANOPY) { id = Rez.Strings.PhCanopy; }
        return WatchUi.loadResource(id);
    }
    function tr(id) as String { return WatchUi.loadResource(id); }
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
        dc.drawText(w / 2, h * 0.32, Graphics.FONT_XTINY, tr(Rez.Strings.Ready), Graphics.TEXT_JUSTIFY_CENTER);

        var q = mRecorder.getGpsQuality();
        var gpsColor = Graphics.COLOR_RED;
        var gpsTxt = tr(Rez.Strings.GpsSearch);
        if (q >= 4) { gpsColor = Graphics.COLOR_GREEN; gpsTxt = tr(Rez.Strings.GpsReady); }
        else if (q == 3) { gpsColor = Graphics.COLOR_GREEN; gpsTxt = tr(Rez.Strings.GpsGood); }
        else if (q == 2) { gpsColor = Graphics.COLOR_YELLOW; gpsTxt = tr(Rez.Strings.GpsWeak); }
        else if (q == 1) { gpsColor = Graphics.COLOR_YELLOW; gpsTxt = tr(Rez.Strings.GpsLast); }
        dc.setColor(gpsColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.46, Graphics.FONT_SMALL, gpsTxt, Graphics.TEXT_JUSTIFY_CENTER);

        var hr = mRecorder.getIdleHr();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.60, Graphics.FONT_XTINY, (hr == null) ? "HR --" : "HR " + hr.format("%d"), Graphics.TEXT_JUSTIFY_CENTER);

        var pending = mRecorder.getPendingUploads();
        var msg = mRecorder.getPostMessage();
        if (pending > 0) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.72, Graphics.FONT_XTINY, pending + " " + tr(Rez.Strings.InQueue), Graphics.TEXT_JUSTIFY_CENTER);
        } else if (msg.length() > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.72, Graphics.FONT_XTINY, msg, Graphics.TEXT_JUSTIFY_CENTER);
        }
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.85, Graphics.FONT_XTINY, tr(Rez.Strings.TapStart), Graphics.TEXT_JUSTIFY_CENTER);
    }

    // ---------------------------------------------------------- recording scene
    function drawScene(dc as Graphics.Dc, w as Number, h as Number, ph as Number) as Void {
        var cx = w / 2.0;
        var cy = h * 0.40;
        var u = w / 22.0;

        dc.setColor(colorFor(ph), Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.07, Graphics.FONT_TINY, labelFor(ph), Graphics.TEXT_JUSTIFY_CENTER);

        if (ph == CLIMB) { sceneClimb(dc, cx, cy, u); }
        else if (ph == EXIT) { sceneExit(dc, cx, cy, u); }
        else if (ph == FREEFALL) { sceneFreefall(dc, cx, cy, u, h); }
        else if (ph == CANOPY) { sceneCanopy(dc, cx, cy, u); }
        else { sceneLanded(dc, cx, cy, u); }

        // compact live stats
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var alt = mRecorder.getCurrentAlt();
        var altTxt = (alt == null) ? "-- m" : alt.format("%d") + " m";
        var hr = mRecorder.getCurrentHr();
        var hrTxt = (hr == null) ? "-- bpm" : hr.format("%d") + " bpm";
        var ffTxt = tr(Rez.Strings.FfPrefix) + " " + mRecorder.getFreefallTime().format("%d") + "s";
        dc.drawText(w * 0.30, h * 0.74, Graphics.FONT_XTINY, altTxt, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w * 0.70, h * 0.74, Graphics.FONT_XTINY, hrTxt, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, h * 0.80, Graphics.FONT_XTINY, ffTxt, Graphics.TEXT_JUSTIFY_CENTER);

        if (mStopArmed) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.90, Graphics.FONT_XTINY, tr(Rez.Strings.TapStopAgain), Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.90, Graphics.FONT_XTINY, tr(Rez.Strings.TapStop), Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // ---------------------------------------------------------- scenes
    // Polished vector animations: clean light stickman with a colored visor on a
    // dark dial, a line-art jump plane, and a ram-air canopy. Drawn each frame.
    const INK = 0xEEF3FB;       // figure stroke (light, on the black AMOLED dial)

    function jp(ox as Float, oy as Float, lx as Float, ly as Float, uss as Float, ca as Float, sa as Float) as Array {
        return [(ox + (lx * uss) * ca - (ly * uss) * sa).toNumber(), (oy + (lx * uss) * sa + (ly * uss) * ca).toNumber()];
    }
    function limbW(dc as Graphics.Dc, p1 as Array, p2 as Array, w as Float, col as Number) as Void {
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(w));
        dc.drawLine(p1[0], p1[1], p2[0], p2[1]);
        var r = maxw(w / 2);
        dc.fillCircle(p1[0], p1[1], r);
        dc.fillCircle(p2[0], p2[1], r);
    }
    function limb3W(dc as Graphics.Dc, p1 as Array, p2 as Array, p3 as Array, w as Float, col as Number) as Void {
        limbW(dc, p1, p2, w, col);
        limbW(dc, p2, p3, w, col);
    }
    // head with a colored visor wedge facing ang
    function headV(dc as Graphics.Dc, x as Number, y as Number, r as Number, ang as Float, visor as Number) as Void {
        dc.setColor(INK, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(x, y, r);
        dc.setColor(visor, Graphics.COLOR_TRANSPARENT);
        var vx = (x + Math.cos(ang) * r * 0.45).toNumber();
        var vy = (y + Math.sin(ang) * r * 0.45).toNumber();
        dc.fillCircle(vx, vy, maxw(r * 0.5));
    }

    function plane(dc as Graphics.Dc, px as Float, py as Float, a as Float, s as Float) as Void {
        var ca = Math.cos(a);
        var sa = Math.sin(a);
        var U = 10.0 * s;
        var hub = jp(px, py, 3.2, -0.05, U, ca, sa);
        // fuselage
        dc.setColor(0xDBE3F0, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            jp(px, py, -3.1, 0.25, U, ca, sa), jp(px, py, -2.7, -0.48, U, ca, sa),
            jp(px, py, 2.2, -0.62, U, ca, sa), jp(px, py, 3.05, -0.3, U, ca, sa),
            jp(px, py, 3.22, 0.0, U, ca, sa), jp(px, py, 3.0, 0.24, U, ca, sa),
            jp(px, py, 2.35, 0.62, U, ca, sa), jp(px, py, -2.7, 0.6, U, ca, sa)
        ]);
        // window strip
        dc.setColor(0x0E1B30, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([jp(px, py, -1.9, -0.34, U, ca, sa), jp(px, py, 2.0, -0.46, U, ca, sa), jp(px, py, 2.45, -0.14, U, ca, sa), jp(px, py, -1.9, -0.04, U, ca, sa)]);
        // brand stripe
        limbW(dc, jp(px, py, -2.4, 0.22, U, ca, sa), jp(px, py, 2.5, 0.06, U, ca, sa), U * 0.16, 0x5B9BFF);
        // tail fin
        dc.setColor(0xDBE3F0, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([jp(px, py, -3.05, -0.4, U, ca, sa), jp(px, py, -2.55, -1.7, U, ca, sa), jp(px, py, -2.1, -1.7, U, ca, sa), jp(px, py, -2.25, -0.45, U, ca, sa)]);
        // high wing
        dc.fillPolygon([jp(px, py, -0.9, -0.62, U, ca, sa), jp(px, py, 2.25, -0.8, U, ca, sa), jp(px, py, 2.4, -0.55, U, ca, sa), jp(px, py, -0.8, -0.4, U, ca, sa)]);
        // strut + gear
        limbW(dc, jp(px, py, -0.1, -0.45, U, ca, sa), jp(px, py, 0.5, 0.22, U, ca, sa), U * 0.07, 0xAAB6C9);
        limbW(dc, jp(px, py, 0.4, 0.6, U, ca, sa), jp(px, py, 0.4, 1.18, U, ca, sa), U * 0.09, 0x8E9BB2);
        limbW(dc, jp(px, py, -0.6, 0.6, U, ca, sa), jp(px, py, -0.6, 1.18, U, ca, sa), U * 0.09, 0x8E9BB2);
        dc.setColor(0x11192B, Graphics.COLOR_TRANSPARENT);
        var w1 = jp(px, py, 0.4, 1.26, U, ca, sa);
        var w2 = jp(px, py, -0.6, 1.26, U, ca, sa);
        dc.fillCircle(w1[0], w1[1], maxw(U * 0.18));
        dc.fillCircle(w2[0], w2[1], maxw(U * 0.18));
        // prop blades + hub
        var pa = mFrame * 0.55;
        for (var b = 0; b < 3; b++) {
            var ang = pa + b * 2.094;
            limbW(dc, hub, [(hub[0] + Math.cos(ang) * U * 1.2).toNumber(), (hub[1] + Math.sin(ang) * U * 1.2).toNumber()], U * 0.09, 0xEEF3FB);
        }
        dc.setColor(0xEEF3FB, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(hub[0], hub[1], maxw(U * 0.13));
    }

    function softCloud(dc as Graphics.Dc, x as Float, y as Float, r as Float) as Void {
        dc.setColor(0x1A2740, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(x.toNumber(), y.toNumber(), maxw(r));
        dc.fillCircle((x + r).toNumber(), (y + r * 0.15).toNumber(), maxw(r * 0.75));
        dc.fillCircle((x - r * 0.9).toNumber(), (y + r * 0.2).toNumber(), maxw(r * 0.62));
        dc.fillCircle((x + r * 0.25).toNumber(), (y - r * 0.4).toNumber(), maxw(r * 0.6));
    }

    function sceneClimb(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var ay = cy + u * 0.6;
        var span = (cx * 2 + u * 4);
        softCloud(dc, ((mFrame * 13 / 10) % span.toNumber()) - u * 2, ay + u * 1.6, u * 1.1);
        softCloud(dc, ((mFrame * 8 / 10 + (span * 0.5).toNumber()) % span.toNumber()) - u * 2, ay + u * 2.6, u * 0.85);
        var bob = Math.sin(mFrame * 0.13) * (u * 0.22);
        plane(dc, cx + Math.sin(mFrame * 0.05) * (u * 0.5), ay + bob, -0.26, 1.05);
    }

    // belly-to-earth stick figure (arched box). flutter scales limb wobble.
    function stickFly(dc as Graphics.Dc, fx as Float, fy as Float, U as Float, rot as Float, visor as Number, flutter as Float) as Void {
        var ca = Math.cos(rot);
        var sa = Math.sin(rot);
        var fl = Math.sin(mFrame * 0.33) * 0.13 * flutter;
        var w = U * 0.5;
        var w2 = U * 0.4;
        // torso
        limbW(dc, jp(fx, fy, 0.0, -0.85, U, ca, sa), jp(fx, fy, 0.05, 0.7, U, ca, sa), w, INK);
        // arms
        limb3W(dc, jp(fx, fy, 0.0, -0.7, U, ca, sa), jp(fx, fy, -1.05, -0.95 - fl, U, ca, sa), jp(fx, fy, -1.55, -1.75 - fl, U, ca, sa), w2, INK);
        limb3W(dc, jp(fx, fy, 0.0, -0.7, U, ca, sa), jp(fx, fy, 1.05, -0.95 + fl, U, ca, sa), jp(fx, fy, 1.55, -1.75 + fl, U, ca, sa), w2, INK);
        // legs
        limb3W(dc, jp(fx, fy, 0.05, 0.65, U, ca, sa), jp(fx, fy, -0.95, 1.5 + fl, U, ca, sa), jp(fx, fy, -0.6, 2.4 + fl, U, ca, sa), w2, INK);
        limb3W(dc, jp(fx, fy, 0.05, 0.65, U, ca, sa), jp(fx, fy, 0.95, 1.5 - fl, U, ca, sa), jp(fx, fy, 0.6, 2.4 - fl, U, ca, sa), w2, INK);
        // head + visor
        var hd = jp(fx, fy, 0.0, -1.4, U, ca, sa);
        headV(dc, hd[0], hd[1], maxw(U * 0.5), 1.5708 + rot, visor);
    }

    function sceneExit(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var loop = (mFrame % 200) / 200.0;
        var e = 0.5 - 0.5 * Math.cos(loop * 3.14159);
        var ps = 0.56 - loop * 0.10;
        plane(dc, cx - 3.0 * u - loop * 1.6 * u, cy - 3.0 * u - loop * 0.5 * u, -0.16, ps);
        var jx = cx - 1.4 * u + (cx + 0.8 * u - (cx - 1.4 * u)) * e;
        var jy = cy - 1.1 * u + (cy + 1.2 * u - (cy - 1.1 * u)) * e;
        var rot = -1.5 + 1.5 * e;
        stickFly(dc, jx, jy, u * 0.95, rot, 0xFFAE46, 0.0);
    }

    function sceneFreefall(dc as Graphics.Dc, cx as Float, cy as Float, u as Float, h as Number) as Void {
        var span = (h * 62 / 100);
        dc.setPenWidth(maxw(u * 0.1));
        for (var i = 0; i < 11; i++) {
            var sx = cx + ((i - 5) * 0.88) * u;
            var off = ((mFrame * 9 + i * 47) % span);
            var sy = cy + 2.6 * u - off;
            dc.setColor(off < span * 0.5 ? 0x6E8FBE : 0x3A4E6B, Graphics.COLOR_TRANSPARENT);
            ln(dc, sx, sy, sx, sy - 1.1 * u);
        }
        var bob = Math.sin(mFrame * 0.11) * (u * 0.12);
        stickFly(dc, cx, cy + bob, u * 1.12, Math.sin(mFrame * 0.06) * 0.06, 0xFF5D7A, 1.0);
    }

    function sceneCanopy(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var sway = Math.sin(mFrame * 0.075) * 0.16;
        var ca = Math.cos(sway);
        var sa = Math.sin(sway);
        var ax = cx;
        var ay = cy + 1.1 * u;
        var halfW = 2.9;
        var depth = 0.62;
        var arc = 0.95;
        var wy = -3.5;
        var N = 9;
        var top = [];
        var bot = [];
        for (var i = 0; i <= N; i++) {
            var uu = (i.toFloat() / N) * 2 - 1;
            var x = uu * halfW;
            var sag = arc * (1 - uu * uu);
            top.add(jp(ax, ay, x, wy - sag - depth, u, ca, sa));
            bot.add(jp(ax, ay, x, wy - sag, u, ca, sa));
        }
        // canopy fill
        var wing = [];
        for (var i = 0; i <= N; i++) { wing.add(top[i]); }
        for (var i = N; i >= 0; i--) { wing.add(bot[i]); }
        dc.setColor(0x14E093, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon(wing);
        // ribs
        dc.setColor(0x05311F, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.06));
        for (var i = 0; i <= N; i++) { dc.drawLine(top[i][0], top[i][1], bot[i][0], bot[i][1]); }
        // nose openings
        dc.setColor(0x04281B, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < N; i++) {
            var mx = (bot[i][0] + bot[i + 1][0]) / 2;
            var my = (bot[i][1] + bot[i + 1][1]) / 2;
            dc.fillCircle(mx, (my + u * 0.12).toNumber(), maxw(u * 0.1));
        }
        // lines + slider
        var riserL = jp(ax, ay, -0.42, -0.1, u, ca, sa);
        var riserR = jp(ax, ay, 0.42, -0.1, u, ca, sa);
        dc.setColor(0xDCE6F5, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        for (var i = 0; i <= N; i++) {
            var tgt = (i <= N / 2) ? riserL : riserR;
            dc.drawLine(bot[i][0], bot[i][1], tgt[0], tgt[1]);
        }
        dc.setColor(0x282E40, Graphics.COLOR_TRANSPARENT);
        var sl = jp(ax, ay, 0.0, -1.5, u, ca, sa);
        dc.fillPolygon([jp(sl[0], sl[1], -1.2 * u, -0.1 * u, 1.0, ca, sa), jp(sl[0], sl[1], 1.2 * u, -0.1 * u, 1.0, ca, sa), jp(sl[0], sl[1], 1.2 * u, 0.1 * u, 1.0, ca, sa), jp(sl[0], sl[1], -1.2 * u, 0.1 * u, 1.0, ca, sa)]);
        // jumper
        var w = u * 0.5;
        var w2 = u * 0.4;
        limbW(dc, jp(ax, ay, 0.0, 0.55, u, ca, sa), jp(ax, ay, 0.0, 1.8, u, ca, sa), w, INK);
        limbW(dc, jp(ax, ay, 0.0, 0.75, u, ca, sa), riserL, w2, INK);
        limbW(dc, jp(ax, ay, 0.0, 0.75, u, ca, sa), riserR, w2, INK);
        limb3W(dc, jp(ax, ay, 0.0, 1.78, u, ca, sa), jp(ax, ay, -0.3, 2.6, u, ca, sa), jp(ax, ay, -0.25, 3.2, u, ca, sa), w2, INK);
        limb3W(dc, jp(ax, ay, 0.0, 1.78, u, ca, sa), jp(ax, ay, 0.3, 2.6, u, ca, sa), jp(ax, ay, 0.32, 3.2, u, ca, sa), w2, INK);
        var hd = jp(ax, ay, 0.0, 0.25, u, ca, sa);
        headV(dc, hd[0], hd[1], maxw(u * 0.42), -1.5708 + sway, 0x1FE39A);
    }

    function sceneLanded(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var gy = cy + 2.3 * u;
        dc.setColor(0x1B2912, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(0, gy.toNumber(), (cx * 2).toNumber(), (cy * 3).toNumber());
        dc.setColor(0x3F5A30, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.12));
        ln(dc, 0.0, gy, cx * 2, gy);
        dc.setColor(0x33502A, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.08));
        for (var i = -3; i <= 3; i++) {
            var gx = cx + i * 1.0 * u;
            ln(dc, gx, gy, gx - u * 0.12, gy - u * 0.4);
            ln(dc, gx, gy, gx + u * 0.12, gy - u * 0.4);
        }
        // collapsed canopy behind
        dc.setColor(0x0DB97C, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([pt(cx + 0.6 * u, gy), pt(cx + 1.2 * u, gy - 0.6 * u), pt(cx + 1.8 * u, gy - 0.22 * u), pt(cx + 2.4 * u, gy - 0.62 * u), pt(cx + 3.0 * u, gy - 0.18 * u), pt(cx + 3.4 * u, gy)]);
        dc.setColor(0xDCE6F5, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        ln(dc, cx + 1.2 * u, gy - 0.45 * u, cx - 0.6 * u, gy - 1.1 * u);
        ln(dc, cx + 2.0 * u, gy - 0.4 * u, cx - 0.45 * u, gy - 1.1 * u);
        // standing stickman
        var sgn = Math.sin(mFrame * 0.05) * 0.04;
        var fx = cx - 1.5 * u;
        var w = u * 0.5;
        var w2 = u * 0.4;
        limb3W(dc, [(fx - 0.05 * u).toNumber(), (gy - 1.45 * u).toNumber()], [(fx - 0.28 * u).toNumber(), (gy - 0.72 * u).toNumber()], [(fx - 0.3 * u).toNumber(), gy.toNumber()], w2, INK);
        limb3W(dc, [(fx + 0.05 * u).toNumber(), (gy - 1.45 * u).toNumber()], [(fx + 0.28 * u).toNumber(), (gy - 0.72 * u).toNumber()], [(fx + 0.3 * u).toNumber(), gy.toNumber()], w2, INK);
        var topp = [(fx + sgn * u).toNumber(), (gy - 2.3 * u).toNumber()];
        limbW(dc, topp, [fx.toNumber(), (gy - 1.4 * u).toNumber()], w, INK);
        limb3W(dc, [(fx + sgn * 0.6 * u).toNumber(), (gy - 2.1 * u).toNumber()], [(fx - 0.5 * u).toNumber(), (gy - 1.7 * u).toNumber()], [(fx - 0.6 * u).toNumber(), (gy - 1.1 * u).toNumber()], w2, INK);
        limb3W(dc, [(fx + sgn * 0.6 * u).toNumber(), (gy - 2.1 * u).toNumber()], [(fx + 0.5 * u).toNumber(), (gy - 1.7 * u).toNumber()], [(fx + 0.6 * u).toNumber(), (gy - 1.1 * u).toNumber()], w2, INK);
        headV(dc, topp[0], (gy - 2.7 * u).toNumber(), maxw(u * 0.42), -1.5708, 0xAEB8CF);
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
