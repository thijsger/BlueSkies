import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;

// Offline-proof upload queue. Jump payloads are persisted in Storage and sent
// sequentially; anything that fails (no phone / no internet on the dropzone)
// stays queued and is retried on the next app launch or next jump. The .FIT
// recording is always the ultimate backup.
class Uploader {

    var mCurKey = null;
    var mSending as Boolean = false;
    var mStatusCb as Lang.Method? = null;

    function initialize() {}

    function setStatusHandler(cb as Lang.Method) as Void { mStatusCb = cb; }

    function pendingCount() as Number {
        var idx = Application.Storage.getValue("uq_idx");
        return (idx instanceof Lang.Array) ? idx.size() : 0;
    }

    // store a payload at the back of the queue
    function enqueue(payload as Dictionary) as Void {
        try {
            var idx = Application.Storage.getValue("uq_idx");
            if (!(idx instanceof Lang.Array)) { idx = []; }
            var key = "uq_" + payload["startTime"].toString() + "_" + idx.size();
            Application.Storage.setValue(key, payload);
            idx.add(key);
            Application.Storage.setValue("uq_idx", idx);
        } catch (e) {
            // Storage full / payload too large — the .FIT backup remains.
        }
    }

    function flush() as Void {
        if (mSending) { return; }
        sendNext();
    }

    function sendNext() as Void {
        var idx = Application.Storage.getValue("uq_idx");
        if (!(idx instanceof Lang.Array) || idx.size() == 0) {
            mSending = false;
            return;
        }
        var key = idx[0];
        var payload = Application.Storage.getValue(key);
        if (payload == null) {
            idx.remove(key);
            Application.Storage.setValue("uq_idx", idx);
            sendNext();
            return;
        }

        var base = Application.Properties.getValue("backendUrl");
        if (base == null || base.length() == 0) { mSending = false; return; }
        while (base.length() > 0 && base.substring(base.length() - 1, base.length()).equals("/")) {
            base = base.substring(0, base.length() - 1);
        }

        mCurKey = key;
        mSending = true;
        var headers = { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON };
        var apiKey = Application.Properties.getValue("apiKey");
        if (apiKey != null && apiKey.length() > 0) {
            headers["x-api-key"] = apiKey;
        }
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Communications.makeWebRequest(base + "/api/jumps", payload as Dictionary, options, method(:onSent));
    }

    function onSent(code as Number, data as Lang.Dictionary or Lang.String or Toybox.PersistedContent.Iterator or Null) as Void {
        var success = (code == 200 || code == 201);
        if (success) {
            var idx = Application.Storage.getValue("uq_idx");
            if (idx instanceof Lang.Array) {
                idx.remove(mCurKey);
                Application.Storage.setValue("uq_idx", idx);
            }
            Application.Storage.deleteValue(mCurKey);
            mCurKey = null;
        } else {
            mSending = false; // give up for now; retry on next launch / jump
        }

        if (mStatusCb != null) {
            mStatusCb.invoke(success, pendingCount());
        }

        if (success) { sendNext(); }
    }
}
