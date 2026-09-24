package hu.kisskorboy.asthetic;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Az alkalmazás önfrissítése.
 *
 * A webes rész (js/frissites.js) kérdezi le a GitHubról, van-e újabb kiadás.
 * Ez a bővítmény csak azt végzi, amit a WebView nem tud:
 *   info()           — a telepített verzió (versionCode / versionName)
 *   letolt({url})    — letölti az APK-t az alkalmazás saját gyorsítótárába,
 *                      közben "letoltes" eseményben jelenti a százalékot
 *   telepit()        — átadja a letöltött APK-t a rendszer telepítőjének
 *   megnyit({url})   — külső böngészőben nyit meg egy címet (tartalék út)
 *
 * A telepítést mindig a felhasználó hagyja jóvá a rendszer ablakában; első
 * alkalommal az Android megkérdezi, engedi-e az Asthetic-nek az ismeretlen
 * forrásból való telepítést.
 */
@CapacitorPlugin(name = "AstheticFrissito")
public class FrissitoPlugin extends Plugin {

    private static final String FAJLNEV = "asthetic-frissites.apk";
    private volatile boolean letoltesFolyik = false;

    private File apkFajl() {
        File mappa = new File(getContext().getCacheDir(), "frissites");
        if (!mappa.exists()) mappa.mkdirs();
        return new File(mappa, FAJLNEV);
    }

    @PluginMethod
    public void info(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long kod = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
            JSObject ret = new JSObject();
            ret.put("versionCode", kod);
            ret.put("versionName", pi.versionName);
            ret.put("telepithet", telepithet());
            call.resolve(ret);
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("A verzió nem kérdezhető le.", e);
        }
    }

    private boolean telepithet() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void letolt(PluginCall call) {
        final String cim = call.getString("url");
        if (cim == null || !cim.startsWith("https://")) {
            call.reject("Érvénytelen letöltési cím.");
            return;
        }
        if (letoltesFolyik) {
            call.reject("Már folyik egy letöltés.");
            return;
        }
        letoltesFolyik = true;

        new Thread(() -> {
            HttpURLConnection kapcsolat = null;
            File cel = apkFajl();
            File ideiglenes = new File(cel.getParentFile(), FAJLNEV + ".resz");
            try {
                // A GitHub a letöltést egy másik (szintén https) címre irányítja át;
                // az azonos protokollon belüli átirányítást a HttpURLConnection követi.
                URL url = new URL(cim);
                kapcsolat = (HttpURLConnection) url.openConnection();
                kapcsolat.setInstanceFollowRedirects(true);
                kapcsolat.setConnectTimeout(20000);
                kapcsolat.setReadTimeout(30000);
                kapcsolat.setRequestProperty("User-Agent", "Asthetic-Android");
                kapcsolat.connect();

                int statusz = kapcsolat.getResponseCode();
                if (statusz < 200 || statusz >= 300) {
                    throw new Exception("A kiszolgáló hibát adott (" + statusz + ").");
                }

                long osszes = kapcsolat.getContentLength();   // -1, ha ismeretlen (a Long változat csak API 24-től van)
                long kesz = 0;
                int utolsoSzazalek = -1;

                try (InputStream be = kapcsolat.getInputStream();
                     OutputStream ki = new FileOutputStream(ideiglenes)) {
                    byte[] puffer = new byte[64 * 1024];
                    int n;
                    while ((n = be.read(puffer)) != -1) {
                        ki.write(puffer, 0, n);
                        kesz += n;
                        if (osszes > 0) {
                            int szazalek = (int) (kesz * 100 / osszes);
                            if (szazalek != utolsoSzazalek) {
                                utolsoSzazalek = szazalek;
                                JSObject esemeny = new JSObject();
                                esemeny.put("szazalek", szazalek);
                                esemeny.put("kesz", kesz);
                                esemeny.put("osszes", osszes);
                                notifyListeners("letoltes", esemeny);
                            }
                        }
                    }
                }

                if (osszes > 0 && kesz != osszes) {
                    throw new Exception("A letöltés megszakadt.");
                }
                if (cel.exists()) cel.delete();
                if (!ideiglenes.renameTo(cel)) throw new Exception("A fájl nem menthető.");

                JSObject ret = new JSObject();
                ret.put("meret", kesz);
                call.resolve(ret);
            } catch (Exception e) {
                ideiglenes.delete();
                call.reject(e.getMessage() != null ? e.getMessage() : "A letöltés nem sikerült.", e);
            } finally {
                if (kapcsolat != null) kapcsolat.disconnect();
                letoltesFolyik = false;
            }
        }).start();
    }

    @PluginMethod
    public void telepit(PluginCall call) {
        File fajl = apkFajl();
        if (!fajl.exists()) {
            call.reject("Nincs letöltött frissítés.");
            return;
        }
        try {
            Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", fajl);
            Intent szandek = new Intent(Intent.ACTION_VIEW);
            szandek.setDataAndType(uri, "application/vnd.android.package-archive");
            szandek.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(szandek);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("A telepítő nem indítható el.", e);
                }
            });
        } catch (Exception e) {
            call.reject("A telepítő nem indítható el.", e);
        }
    }

    /** Ha a rendszer még nem engedi, a beállítások megfelelő oldalára visz. */
    @PluginMethod
    public void engedelyKer(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || telepithet()) {
            call.resolve();
            return;
        }
        try {
            Intent szandek = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            szandek.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(szandek);
            call.resolve();
        } catch (Exception e) {
            call.reject("A beállítások nem nyithatók meg.", e);
        }
    }

    @PluginMethod
    public void megnyit(PluginCall call) {
        String cim = call.getString("url");
        if (cim == null || !cim.startsWith("https://")) {
            call.reject("Érvénytelen cím.");
            return;
        }
        try {
            Intent szandek = new Intent(Intent.ACTION_VIEW, Uri.parse(cim));
            szandek.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(szandek);
            call.resolve();
        } catch (Exception e) {
            call.reject("A böngésző nem nyitható meg.", e);
        }
    }
}
