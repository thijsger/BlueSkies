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
    // A detailed jump plane (high-wing, fixed gear, spinning prop) centred at
    // px,py, tilted by ca/sa, scaled by s (units of u). Door + jumper drawn by caller.
    function plane(dc as Graphics.Dc, px as Float, py as Float, u as Float, ca as Float, sa as Float, s as Float) as Void {
        // fuselage
        dc.setColor(0xC4CCDB, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            rp(px, py, -3.0 * u * s, 0.25 * u * s, ca, sa), rp(px, py, -2.6 * u * s, -0.5 * u * s, ca, sa),
            rp(px, py, 2.2 * u * s, -0.62 * u * s, ca, sa), rp(px, py, 3.1 * u * s, -0.18 * u * s, ca, sa),
            rp(px, py, 3.25 * u * s, 0.1 * u * s, ca, sa), rp(px, py, 2.4 * u * s, 0.6 * u * s, ca, sa),
            rp(px, py, -2.6 * u * s, 0.62 * u * s, ca, sa)
        ]);
        // tail fin
        dc.fillPolygon([
            rp(px, py, -3.0 * u * s, -0.4 * u * s, ca, sa), rp(px, py, -2.5 * u * s, -1.7 * u * s, ca, sa),
            rp(px, py, -2.05 * u * s, -1.7 * u * s, ca, sa), rp(px, py, -2.2 * u * s, -0.45 * u * s, ca, sa)
        ]);
        // high wing on top
        dc.setColor(0xAEB8C9, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            rp(px, py, -0.9 * u * s, -0.62 * u * s, ca, sa), rp(px, py, 2.2 * u * s, -0.78 * u * s, ca, sa),
            rp(px, py, 2.3 * u * s, -0.56 * u * s, ca, sa), rp(px, py, -0.8 * u * s, -0.42 * u * s, ca, sa)
        ]);
        // cockpit window
        dc.setColor(0x0A1426, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            rp(px, py, 2.3 * u * s, -0.45 * u * s, ca, sa), rp(px, py, 3.0 * u * s, -0.12 * u * s, ca, sa),
            rp(px, py, 2.95 * u * s, 0.12 * u * s, ca, sa), rp(px, py, 2.35 * u * s, 0.05 * u * s, ca, sa)
        ]);
        // cabin windows
        dc.setColor(0x7FA8E6, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < 5; i++) {
            var q = rp(px, py, (1.4 - i * 0.8) * u * s, -0.15 * u * s, ca, sa);
            dc.fillCircle(q[0], q[1], maxw(u * s * 0.14));
        }
        // landing gear + wheels
        dc.setColor(0xAEB8C9, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * s * 0.1));
        rln(dc, px, py, 0.3 * u * s, 0.6 * u * s, 0.3 * u * s, 1.15 * u * s, ca, sa);
        rln(dc, px, py, -0.6 * u * s, 0.6 * u * s, -0.6 * u * s, 1.15 * u * s, ca, sa);
        dc.setColor(0x2B3346, Graphics.COLOR_TRANSPARENT);
        var wa = rp(px, py, 0.3 * u * s, 1.2 * u * s, ca, sa);
        var wb = rp(px, py, -0.6 * u * s, 1.2 * u * s, ca, sa);
        dc.fillCircle(wa[0], wa[1], maxw(u * s * 0.18));
        dc.fillCircle(wb[0], wb[1], maxw(u * s * 0.18));
        // spinning propeller at the nose
        dc.setColor(0xDFE6F2, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * s * 0.12));
        var hub = rp(px, py, 3.25 * u * s, -0.04 * u * s, ca, sa);
        var pa = mFrame * 0.9;
        for (var b = 0; b < 3; b++) {
            var ang = pa + b * 2.094;
            dc.drawLine(hub[0], hub[1],
                (hub[0] + Math.cos(ang) * u * s * 1.2).toNumber(),
                (hub[1] + Math.sin(ang) * u * s * 1.2).toNumber());
        }
        dc.fillCircle(hub[0], hub[1], maxw(u * s * 0.12));
    }

    function cloud(dc as Graphics.Dc, x as Float, y as Float, u as Float) as Void {
        dc.setColor(0x1B2B45, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(x.toNumber(), y.toNumber(), (u * 0.9).toNumber());
        dc.fillCircle((x + u * 0.9).toNumber(), (y + u * 0.1).toNumber(), (u * 0.7).toNumber());
        dc.fillCircle((x - u * 0.8).toNumber(), (y + u * 0.15).toNumber(), (u * 0.6).toNumber());
        dc.fillCircle((x + u * 0.2).toNumber(), (y - u * 0.4).toNumber(), (u * 0.6).toNumber());
    }

    function sceneClimb(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var bob = Math.sin(mFrame * 0.06) * (u * 0.18);
        var drift = Math.sin(mFrame * 0.03) * (u * 0.6);
        var span = cx * 2 + u * 4;
        cloud(dc, ((mFrame * 0.7).toNumber() % span.toNumber()) - u * 2, cy + u * 2.4, u);
        cloud(dc, ((mFrame * 0.4 + span * 0.55).toNumber() % span.toNumber()) - u * 2, cy + u * 3.4, u * 0.8);

        var px = cx + drift;
        var py = cy + bob;
        var a = -0.30;
        var ca = Math.cos(a);
        var sa = Math.sin(a);

        // climb trail dots behind the tail
        dc.setColor(0x355479, Graphics.COLOR_TRANSPARENT);
        for (var i = 1; i <= 6; i++) {
            var q = rp(px, py, (-3.2 - i * 0.7) * u, 0.1 * u, ca, sa);
            dc.fillCircle(q[0], q[1], maxw(u * 0.09));
        }

        plane(dc, px, py, u, ca, sa, 1.0);

        // open jump door + jumper silhouette inside
        dc.setColor(0x0A1426, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            rp(px, py, -1.7 * u, -0.3 * u, ca, sa), rp(px, py, -0.9 * u, -0.35 * u, ca, sa),
            rp(px, py, -0.9 * u, 0.45 * u, ca, sa), rp(px, py, -1.7 * u, 0.5 * u, ca, sa)
        ]);
        dc.setColor(0x4F8DFF, Graphics.COLOR_TRANSPARENT);
        var j = rp(px, py, -1.3 * u, 0.05 * u, ca, sa);
        dc.fillCircle(j[0], j[1], maxw(u * 0.2));
    }

    function sceneExit(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        // plane banking away, up-left, smaller
        var a = -0.18;
        var ca = Math.cos(a);
        var sa = Math.sin(a);
        var px = cx - 3.4 * u + Math.sin(mFrame * 0.04) * (u * 0.2);
        var py = cy - 3.0 * u;
        plane(dc, px, py, u, ca, sa, 0.62);
        dc.setColor(0x0A1426, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            rp(px, py, -1.7 * u * 0.62, -0.3 * u * 0.62, ca, sa), rp(px, py, -0.9 * u * 0.62, -0.35 * u * 0.62, ca, sa),
            rp(px, py, -0.9 * u * 0.62, 0.5 * u * 0.62, ca, sa), rp(px, py, -1.7 * u * 0.62, 0.55 * u * 0.62, ca, sa)
        ]);

        // dashed separation arc from the door toward the jumper
        dc.setColor(0x7A571E, Graphics.COLOR_TRANSPARENT);
        var ax = px + 0.6 * u;
        var ay = py + 1.0 * u;
        var bx = cx + 0.4 * u;
        var by = cy + 0.6 * u;
        for (var k = 0; k <= 6; k++) {
            if (k % 2 == 0) {
                var t0 = k / 7.0;
                var t1 = (k + 1) / 7.0;
                dc.fillCircle(qbx(ax, cx - 1.0 * u, bx, t0).toNumber(), qby(ay, cy - 0.4 * u, by, t0).toNumber(), maxw(u * 0.07));
                dc.fillCircle(qbx(ax, cx - 1.0 * u, bx, t1).toNumber(), qby(ay, cy - 0.4 * u, by, t1).toNumber(), maxw(u * 0.07));
            }
        }

        // relative-wind streaks hitting the diving jumper
        dc.setColor(0x3A5170, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.1));
        var woff = (mFrame % maxw(u * 1.0)).toFloat();
        for (var i = 0; i < 4; i++) {
            var yy = cy + 1.7 * u + i * 0.5 * u;
            ln(dc, cx + 1.8 * u - woff, yy, cx + 0.9 * u - woff, yy - 0.4 * u);
        }

        // jumper just exited: arched dive presentation, rolling as they tip in
        var rot = -0.9 + Math.sin(mFrame * 0.18) * 0.5;
        var jca = Math.cos(rot);
        var jsa = Math.sin(rot);
        var fx = cx + 0.4 * u;
        var fy = cy + 0.5 * u;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.2));
        var head = rp(fx, fy, 0.0, -1.35 * u, jca, jsa);
        dc.fillCircle(head[0], head[1], maxw(u * 0.42));
        // torso
        rln(dc, fx, fy, 0.0, -0.95 * u, 0.1 * u, 0.5 * u, jca, jsa);
        // arms reaching forward
        var sh = rp(fx, fy, 0.0, -0.75 * u, jca, jsa);
        var e1 = rp(fx, fy, -1.0 * u, -1.0 * u, jca, jsa);
        var w1 = rp(fx, fy, -1.7 * u, -1.4 * u, jca, jsa);
        dc.drawLine(sh[0], sh[1], e1[0], e1[1]); dc.drawLine(e1[0], e1[1], w1[0], w1[1]);
        var e2 = rp(fx, fy, 0.9 * u, -1.15 * u, jca, jsa);
        var w2 = rp(fx, fy, 1.6 * u, -1.55 * u, jca, jsa);
        dc.drawLine(sh[0], sh[1], e2[0], e2[1]); dc.drawLine(e2[0], e2[1], w2[0], w2[1]);
        // legs bent (box) trailing
        var hip = rp(fx, fy, 0.1 * u, 0.5 * u, jca, jsa);
        var k1 = rp(fx, fy, -0.2 * u, 1.4 * u, jca, jsa);
        var f1 = rp(fx, fy, -1.1 * u, 1.3 * u, jca, jsa);
        dc.drawLine(hip[0], hip[1], k1[0], k1[1]); dc.drawLine(k1[0], k1[1], f1[0], f1[1]);
        var k2 = rp(fx, fy, 0.6 * u, 1.45 * u, jca, jsa);
        var f2 = rp(fx, fy, 1.4 * u, 1.7 * u, jca, jsa);
        dc.drawLine(hip[0], hip[1], k2[0], k2[1]); dc.drawLine(k2[0], k2[1], f2[0], f2[1]);
    }

    function sceneFreefall(dc as Graphics.Dc, cx as Float, cy as Float, u as Float, h as Number) as Void {
        // strong upward wind streaks
        var span = h * 0.6;
        dc.setPenWidth(maxw(u * 0.11));
        for (var i = 0; i < 9; i++) {
            var sx = cx + ((i - 4) * 0.95) * u + (i % 2 == 1 ? u * 0.3 : 0.0);
            var off = ((mFrame * 11 + i * 53) % span.toNumber());
            var sy = cy + 2.4 * u - off;
            dc.setColor(off < span * 0.5 ? 0x4A6488 : 0x2E3F58, Graphics.COLOR_TRANSPARENT);
            ln(dc, sx, sy, sx, sy - 1.0 * u);
        }

        // arched belly-to-earth box position, seen from behind & above
        var fl = Math.sin(mFrame * 0.4) * (u * 0.12);
        var bob = Math.sin(mFrame * 0.25) * (u * 0.1);
        var yaw = Math.sin(mFrame * 0.12) * 0.08;
        var ca = Math.cos(yaw);
        var sa = Math.sin(yaw);
        var fx = cx;
        var fy = cy + bob;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.22));
        // helmet
        var head = rp(fx, fy, 0.0, -1.5 * u, ca, sa);
        dc.fillCircle(head[0], head[1], maxw(u * 0.5));
        // goggles accent
        dc.setColor(0x0B1020, Graphics.COLOR_TRANSPARENT);
        var gg = rp(fx, fy, 0.0, -1.62 * u, ca, sa);
        dc.fillCircle(gg[0], gg[1], maxw(u * 0.22));
        // torso (jumpsuit)
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            rp(fx, fy, -0.5 * u, -0.95 * u, ca, sa), rp(fx, fy, 0.5 * u, -0.95 * u, ca, sa),
            rp(fx, fy, 0.42 * u, 0.55 * u, ca, sa), rp(fx, fy, -0.42 * u, 0.55 * u, ca, sa)
        ]);
        // arms: upper out, forearms forward & bent
        var shL = rp(fx, fy, -0.5 * u, -0.8 * u, ca, sa);
        var aeL = rp(fx, fy, -1.5 * u, (-1.0 + 0.0) * u + fl, ca, sa);
        var awL = rp(fx, fy, -1.7 * u, -1.9 * u + fl, ca, sa);
        dc.drawLine(shL[0], shL[1], aeL[0], aeL[1]); dc.drawLine(aeL[0], aeL[1], awL[0], awL[1]);
        var shR = rp(fx, fy, 0.5 * u, -0.8 * u, ca, sa);
        var aeR = rp(fx, fy, 1.5 * u, -1.0 * u - fl, ca, sa);
        var awR = rp(fx, fy, 1.7 * u, -1.9 * u - fl, ca, sa);
        dc.drawLine(shR[0], shR[1], aeR[0], aeR[1]); dc.drawLine(aeR[0], aeR[1], awR[0], awR[1]);
        // legs: thighs out, shins bent
        var hipL = rp(fx, fy, -0.42 * u, 0.55 * u, ca, sa);
        var keL = rp(fx, fy, -1.15 * u, 1.5 * u - fl, ca, sa);
        var kfL = rp(fx, fy, -0.7 * u, 2.4 * u - fl, ca, sa);
        dc.drawLine(hipL[0], hipL[1], keL[0], keL[1]); dc.drawLine(keL[0], keL[1], kfL[0], kfL[1]);
        var hipR = rp(fx, fy, 0.42 * u, 0.55 * u, ca, sa);
        var keR = rp(fx, fy, 1.15 * u, 1.5 * u + fl, ca, sa);
        var kfR = rp(fx, fy, 0.7 * u, 2.4 * u + fl, ca, sa);
        dc.drawLine(hipR[0], hipR[1], keR[0], keR[1]); dc.drawLine(keR[0], keR[1], kfR[0], kfR[1]);
    }

    function sceneCanopy(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var sway = Math.sin(mFrame * 0.07) * 0.16; // radians
        var ca = Math.cos(sway);
        var sa = Math.sin(sway);
        var ax = cx;
        var ay = cy + 1.3 * u; // pivot near jumper

        // ram-air rectangular wing (square), arced, with cells
        var halfW = 2.7;
        var depth = 0.62;
        var arc = 0.95;
        var wy = -3.2;
        var N = 8;
        var topPts = [];
        var botPts = [];
        for (var i = 0; i <= N; i++) {
            var t = (i.toFloat() / N) * 2 - 1;
            var x = t * halfW;
            var sag = arc * (1 - t * t);
            topPts.add(rp(ax, ay, x * u, (wy - sag - depth) * u, ca, sa));
            botPts.add(rp(ax, ay, x * u, (wy - sag) * u, ca, sa));
        }
        // fill canopy: top edge then bottom edge reversed
        var wing = [];
        for (var i = 0; i <= N; i++) { wing.add(topPts[i]); }
        for (var i = N; i >= 0; i--) { wing.add(botPts[i]); }
        dc.setColor(0x10D68A, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon(wing);
        // cell dividers / ribs
        dc.setColor(0x064B33, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.07));
        for (var i = 0; i <= N; i++) { dc.drawLine(topPts[i][0], topPts[i][1], botPts[i][0], botPts[i][1]); }

        // suspension lines cascading to two riser points at the jumper
        dc.setColor(0xD2DCEB, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        var riserL = rp(ax, ay, -0.4 * u, -0.2 * u, ca, sa);
        var riserR = rp(ax, ay, 0.4 * u, -0.2 * u, ca, sa);
        for (var i = 0; i <= N; i++) {
            var tgt = (i <= N / 2) ? riserL : riserR;
            dc.drawLine(botPts[i][0], botPts[i][1], tgt[0], tgt[1]);
        }

        // jumper in harness, hands up to risers, legs relaxed
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.2));
        var head = rp(ax, ay, 0.0, 0.35 * u, ca, sa);
        dc.fillCircle(head[0], head[1], maxw(u * 0.4));
        var neck = rp(ax, ay, 0.0, 0.7 * u, ca, sa);
        var hip = rp(ax, ay, 0.0, 1.75 * u, ca, sa);
        dc.drawLine(neck[0], neck[1], hip[0], hip[1]);
        var sh = rp(ax, ay, 0.0, 0.85 * u, ca, sa);
        dc.drawLine(sh[0], sh[1], riserL[0], riserL[1]);
        dc.drawLine(sh[0], sh[1], riserR[0], riserR[1]);
        var lkL = rp(ax, ay, -0.3 * u, 2.6 * u, ca, sa);
        var lfL = rp(ax, ay, -0.25 * u, 3.2 * u, ca, sa);
        dc.drawLine(hip[0], hip[1], lkL[0], lkL[1]); dc.drawLine(lkL[0], lkL[1], lfL[0], lfL[1]);
        var lkR = rp(ax, ay, 0.3 * u, 2.6 * u, ca, sa);
        var lfR = rp(ax, ay, 0.35 * u, 3.2 * u, ca, sa);
        dc.drawLine(hip[0], hip[1], lkR[0], lkR[1]); dc.drawLine(lkR[0], lkR[1], lfR[0], lfR[1]);
    }

    function sceneLanded(dc as Graphics.Dc, cx as Float, cy as Float, u as Float) as Void {
        var gy = cy + 2.2 * u;
        // ground
        dc.setColor(0x5B6B50, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.14));
        ln(dc, cx - 3.4 * u, gy, cx + 3.4 * u, gy);
        // grass tufts
        dc.setColor(0x46603A, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.08));
        for (var i = -3; i <= 3; i++) {
            var gx = cx + i * 1.0 * u;
            ln(dc, gx, gy, gx - u * 0.12, gy - u * 0.4);
            ln(dc, gx, gy, gx + u * 0.12, gy - u * 0.4);
        }
        // deflated ram-air canopy puddled behind (right)
        dc.setColor(0x10D68A, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([
            pt(cx + 0.7 * u, gy), pt(cx + 1.3 * u, gy - 0.55 * u), pt(cx + 1.9 * u, gy - 0.2 * u),
            pt(cx + 2.4 * u, gy - 0.6 * u), pt(cx + 3.1 * u, gy - 0.15 * u), pt(cx + 3.3 * u, gy)
        ]);
        // slack lines from canopy to jumper
        dc.setColor(0x8893A8, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        ln(dc, cx + 1.3 * u, gy - 0.4 * u, cx - 0.7 * u, gy - 1.0 * u);
        ln(dc, cx + 2.0 * u, gy - 0.3 * u, cx - 0.6 * u, gy - 1.0 * u);

        // standing jumper (left), slight idle sway
        var s = Math.sin(mFrame * 0.06) * (u * 0.05);
        var fx = cx - 1.4 * u + s;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(maxw(u * 0.2));
        dc.fillCircle(fx.toNumber(), (gy - 2.5 * u).toNumber(), maxw(u * 0.42));
        ln(dc, fx, gy - 2.1 * u, fx, gy - 1.0 * u);          // torso
        ln(dc, fx, gy - 1.85 * u, fx - 0.55 * u, gy - 1.5 * u); ln(dc, fx - 0.55 * u, gy - 1.5 * u, fx - 0.7 * u, gy - 0.95 * u);
        ln(dc, fx, gy - 1.85 * u, fx + 0.55 * u, gy - 1.5 * u); ln(dc, fx + 0.55 * u, gy - 1.5 * u, fx + 0.7 * u, gy - 0.95 * u);
        ln(dc, fx, gy - 1.0 * u, fx - 0.45 * u, gy);          // legs
        ln(dc, fx, gy - 1.0 * u, fx + 0.45 * u, gy);
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
