package com.aizeek.newsnook;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONArray;

/**
 * Same Share contract for explicit private exports. Build provider URIs with the ordinary
 * base Context: the main-process provider must resolve exactly the same narrow XML roots.
 */
@CapacitorPlugin(name = "Share")
public final class PrivateSharePlugin extends Plugin {
    private boolean presenting;
    private boolean stopped;

    @PluginMethod public void canShare(PluginCall call) {
        call.resolve(new JSObject().put("value", getActivity() instanceof PrivateBrowserActivity));
    }

    @PluginMethod public void share(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!(getActivity() instanceof PrivateBrowserActivity)
                    || !((PrivateBrowserActivity) getActivity()).isPrivateReady()) {
                call.reject("隐私会话已关闭");
                return;
            }
            if (presenting) { call.reject("分享操作尚未完成"); return; }
            try {
                Intent share = buildShareIntent(getActivity().getBaseContext(), call.getData());
                Intent chooser = Intent.createChooser(share, call.getString("dialogTitle", "分享"));
                stopped = false;
                presenting = true;
                startActivityForResult(call, chooser, "shareResult");
            } catch (Exception error) {
                presenting = false;
                call.reject("无法分享此内容，请重试");
            }
        });
    }

    @ActivityCallback private void shareResult(PluginCall call, ActivityResult result) {
        presenting = false;
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED && !stopped) call.reject("分享已取消");
        else call.resolve(new JSObject().put("activityType", ""));
    }

    @Override protected void handleOnStop() { stopped = true; }

    static Intent buildShareIntent(Context base, JSObject options) throws Exception {
        String text = options.isNull("text") ? null : options.optString("text", null);
        String url = options.isNull("url") ? null : options.optString("url", null);
        JSONArray files = options.optJSONArray("files");
        ArrayList<String> paths = new ArrayList<>();
        if (files != null) {
            if (files.length() > 32) throw new IOException("too many private exports");
            for (int index = 0; index < files.length(); index++) paths.add(files.getString(index));
        }
        if (url != null && !url.isEmpty()) {
            Uri address = Uri.parse(url);
            String scheme = address.getScheme();
            if ("file".equalsIgnoreCase(scheme)) paths.add(url);
            else if (("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                    && address.getHost() != null)
                text = text == null || text.isEmpty() ? url : text + " " + url;
            else throw new IOException("unsupported private share URL");
        }
        if (paths.isEmpty() && (text == null || text.isEmpty())) throw new IOException("empty private share");
        Intent intent = new Intent(paths.size() > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND);
        intent.setType("text/plain");
        if (text != null) intent.putExtra(Intent.EXTRA_TEXT, text);
        if (!options.isNull("title")) intent.putExtra(Intent.EXTRA_SUBJECT, options.optString("title", ""));
        if (paths.isEmpty()) return intent;

        ArrayList<Uri> uris = new ArrayList<>();
        for (String path : paths) uris.add(privateFileUri(base, path));
        String extension = MimeTypeMap.getFileExtensionFromUrl(paths.get(0)).toLowerCase(Locale.ROOT);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        intent.setType(uris.size() == 1 && mime != null ? mime : "*/*");
        ClipData clip = ClipData.newRawUri("", uris.get(0));
        for (int index = 1; index < uris.size(); index++) clip.addItem(new ClipData.Item(uris.get(index)));
        intent.setClipData(clip);
        if (uris.size() == 1) intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        else intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }

    private static Uri privateFileUri(Context base, String path) throws IOException {
        Uri address = Uri.parse(path);
        if (!"file".equalsIgnoreCase(address.getScheme()) || address.getPath() == null)
            throw new IOException("private exports require file URLs");
        File file = new File(address.getPath()).getCanonicalFile();
        File cache = new File(base.getCacheDir(), PrivateBrowserSession.TEMP_DIRECTORY).getCanonicalFile();
        File files = new File(base.getFilesDir(), PrivateBrowserSession.TEMP_DIRECTORY).getCanonicalFile();
        String absolute = file.getPath();
        if ((!absolute.startsWith(cache.getPath() + File.separator)
                && !absolute.startsWith(files.getPath() + File.separator)) || !file.isFile())
            throw new IOException("file is outside the private export directory");
        return FileProvider.getUriForFile(base, base.getPackageName() + ".privatefileprovider", file);
    }
}
