package com.tivalsdeveloper.tivalsai;

import android.Manifest;
import android.app.Activity;
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
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String HOME_URL = "https://ai.tivalsdeveloper.site/";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private boolean errorDialogVisible = false;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(5,18,38));
        getWindow().setNavigationBarColor(Color.rgb(5,18,38));
        webView=new WebView(this); webView.setBackgroundColor(Color.rgb(5,18,38)); setContentView(webView); configureWebView();
        if(state==null){Uri incoming=getIntent().getData(); webView.loadUrl(incoming!=null?incoming.toString():HOME_URL);} else webView.restoreState(state);
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},2001);
    }

    private void configureWebView(){
        WebSettings s=webView.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true); s.setAllowFileAccess(true); s.setAllowContentAccess(true); s.setMediaPlaybackRequiresUserGesture(false); s.setLoadWithOverviewMode(true); s.setUseWideViewPort(true); s.setBuiltInZoomControls(false); s.setSupportZoom(false); s.setUserAgentString(s.getUserAgentString()+" TivalsAI-Android/7.0");
        CookieManager c=CookieManager.getInstance(); c.setAcceptCookie(true); c.setAcceptThirdPartyCookies(webView,true);
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return handleUrl(r.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView v,String url){return handleUrl(Uri.parse(url));}
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){super.onReceivedError(v,r,e);if(r.isForMainFrame())showLoadError(e==null?"The service could not be loaded.":e.getDescription().toString());}
        });
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams p){if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=cb;try{startActivityForResult(p.createIntent(),FILE_CHOOSER_REQUEST);}catch(ActivityNotFoundException e){fileCallback=null;Toast.makeText(MainActivity.this,"No file picker is available.",Toast.LENGTH_LONG).show();return false;}return true;}
            @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(request::deny);}
        });
        webView.setDownloadListener((url,ua,cd,mime,len)->{try{DownloadManager.Request r=new DownloadManager.Request(Uri.parse(url));r.setMimeType(mime);r.addRequestHeader("User-Agent",ua);String cookie=CookieManager.getInstance().getCookie(url);if(cookie!=null)r.addRequestHeader("Cookie",cookie);r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);r.setDestinationInExternalFilesDir(MainActivity.this,Environment.DIRECTORY_DOWNLOADS,null);((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(r);Toast.makeText(MainActivity.this,"Download started",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(MainActivity.this,"Unable to start download.",Toast.LENGTH_LONG).show();}});
    }

    private boolean isWeb(String scheme){return "http".equalsIgnoreCase(scheme)||"https".equalsIgnoreCase(scheme);}
    private boolean handleUrl(Uri uri){
        String scheme=uri.getScheme()==null?"":uri.getScheme();
        // Keep every normal web page, including Google OAuth, inside Tivals AI.
        // This prevents Chrome from taking over the app experience.
        if(isWeb(scheme)){webView.loadUrl(uri.toString());return true;}
        if("mailto".equals(scheme)||"tel".equals(scheme)||"sms".equals(scheme)||"intent".equals(scheme)){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException ignored){Toast.makeText(this,"No compatible app is installed.",Toast.LENGTH_SHORT).show();}return true;}
        return false;
    }

    private void showLoadError(String detail){if(isFinishing()||errorDialogVisible)return;errorDialogVisible=true;new AlertDialog.Builder(this).setTitle("Tivals AI could not connect").setMessage("Tivals AI could not reach its online service.\n\n"+detail).setPositiveButton("Try again",(d,w)->{errorDialogVisible=false;webView.loadUrl(HOME_URL);}).setNegativeButton("Close",(d,w)->errorDialogVisible=false).setOnCancelListener(d->errorDialogVisible=false).show();}

    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(intent.getData()!=null&&webView!=null)webView.loadUrl(intent.getData().toString());}
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){super.onActivityResult(requestCode,resultCode,data);if(requestCode==FILE_CHOOSER_REQUEST&&fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));fileCallback=null;}}
    @Override protected void onSaveInstanceState(Bundle out){webView.saveState(out);super.onSaveInstanceState(out);}
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(webView!=null){webView.stopLoading();webView.destroy();}super.onDestroy();}
}
