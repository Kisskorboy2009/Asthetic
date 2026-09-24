package hu.kisskorboy.asthetic;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // A saját (nem npm-es) bővítményeket a híd felépülése ELŐTT kell
        // regisztrálni — a super.onCreate építi fel a hidat.
        registerPlugin(FrissitoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
