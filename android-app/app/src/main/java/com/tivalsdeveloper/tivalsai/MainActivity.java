package com.tivalsdeveloper.tivalsai;

import android.Manifest;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {
    private static final String HOME_URL = "https://ai.tivalsdeveloper.site/";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int WEB_PERMISSION_REQUEST = 2002;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPermission;
    private boolean errorDialogVisible;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(5,18,38));
        getWindow().setNavigationBarColor(Color.rgb(5,18,38));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(5,18,38));
        setContentView(webView);
        configureWebView();
        if (state == null) {
            Uri incoming = getIntent().getData();
            webView.loadUrl(incoming != null ? incoming.toString() : HOME_URL);
        } else webView.restoreState(state);
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2001);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true); s.setAllowContentAccess(true); s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true); s.setUseWideViewPort(true); s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " TivalsAI-Android/8.0.2");
        CookieManager cookies = CookieManager.getInstance(); cookies.setAcceptCookie(true); cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return handleUrl(r.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) { return handleUrl(Uri.parse(url)); }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                super.onReceivedError(v,r,e);
                if (r.isForMainFrame()) showLoadError(e == null ? "The service could not be loaded." : e.getDescription().toString());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = cb;
                try { startActivityForResult(p.createIntent(), FILE_CHOOSER_REQUEST); }
                catch (ActivityNotFoundException e) { fileCallback=null; Toast.makeText(MainActivity.this,"No file picker is available.",Toast.LENGTH_LONG).show(); return false; }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    pendingWebPermission = request;
                    ActivityCompat.requestPermissions(MainActivity.this,
                        new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, WEB_PERMISSION_REQUEST);
                });
            }
        });

        webView.setDownloadListener((url, ua, contentDisposition, mimeType, contentLength) ->
            startDownload(url, ua, contentDisposition, mimeType));
    }

    private void startDownload(String url, String userAgent, String contentDisposition, String mimeType) {
        try {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
                Toast.makeText(this,"This download type is not supported yet.",Toast.LENGTH_LONG).show();
                return;
            }
            String resolvedMime = mimeType;
            if (resolvedMime == null || resolvedMime.isEmpty() || "application/octet-stream".equals(resolvedMime)) {
                String ext = MimeTypeMap.getFileExtensionFromUrl(url);
                String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext == null ? "" : ext.toLowerCase());
                if (guessed != null) resolvedMime = guessed;
            }
            String filename = URLUtil.guessFileName(url, contentDisposition, resolvedMime);
            if (filename == null || filename.trim().isEmpty()) filename = "tivals-ai-download-" + System.currentTimeMillis();

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            if (resolvedMime != null && !resolvedMime.isEmpty()) request.setMimeType(resolvedMime);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.setTitle(filename);
            request.setDescription("Downloading from Tivals AI");
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this,"Downloading " + filename + " to Downloads",Toast.LENGTH_LONG).show();
        } catch(Exception e) {
            Toast.makeText(this,"Unable to download this file.",Toast.LENGTH_LONG).show();
        }
    }

    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) { webView.loadUrl(uri.toString()); return true; }
        if ("mailto".equals(scheme)||"tel".equals(scheme)||"sms".equals(scheme)||"intent".equals(scheme)) {
            try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch(ActivityNotFoundException ignored) { Toast.makeText(this,"No compatible app is installed.",Toast.LENGTH_SHORT).show(); }
            return true;
        }
        return false;
    }

    private void showLoadError(String detail) {
        if(isFinishing()||errorDialogVisible) return; errorDialogVisible=true;
        new AlertDialog.Builder(this).setTitle("Tivals AI could not connect").setMessage("Tivals AI could not reach its online AI service.\n\n"+detail)
            .setPositiveButton("Try again",(d,w)->{errorDialogVisible=false;webView.loadUrl(HOME_URL);})
            .setNegativeButton("Close",(d,w)->errorDialogVisible=false).setOnCancelListener(d->errorDialogVisible=false).show();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if(requestCode==WEB_PERMISSION_REQUEST && pendingWebPermission!=null) {
            boolean camera = ContextCompat.checkSelfPermission(this,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED;
            boolean mic = ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED;
            if(camera||mic) pendingWebPermission.grant(pendingWebPermission.getResources()); else pendingWebPermission.deny();
            pendingWebPermission=null;
        }
    }

    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(intent.getData()!=null&&webView!=null)webView.loadUrl(intent.getData().toString());}
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){super.onActivityResult(requestCode,resultCode,data);if(requestCode==FILE_CHOOSER_REQUEST&&fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));fileCallback=null;}}
    @Override protected void onSaveInstanceState(Bundle out){webView.saveState(out);super.onSaveInstanceState(out);}
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(webView!=null){webView.stopLoading();webView.destroy();}super.onDestroy();}
}
