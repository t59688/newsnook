package com.aizeek.newsnook;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keystore 支撑的安全存储：长期 Session token 与同步下来的 Secret 明文只走这里。
 *
 * 密钥由 AndroidKeyStore 生成并保管，App 拿不到密钥材料本身；SharedPreferences 里
 * 只留 {iv, ciphertext} 的 Base64。不使用已废弃的 EncryptedSharedPreferences。
 *
 * 任何一次失败都只返回空值/错误码，绝不把明文写进日志。
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    private static final String PREFS_NAME = "newsnook_secure_store";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "newsnook.secure.store.v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;
    private static final String SEPARATOR = ":";

    private SharedPreferences prefs() {
        Context context = getContext();
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** Keystore 里没有就现生成一把；密钥永远不离开 Keystore。 */
    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);

        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // 不绑定生物识别：同步要在后台无人值守地跑
            .setUserAuthenticationRequired(false)
            .build();
        generator.init(spec);
        return generator.generateKey();
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.isEmpty() || value == null) {
            call.reject("key and value are required");
            return;
        }

        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String stored =
                Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) +
                SEPARATOR +
                Base64.encodeToString(ciphertext, Base64.NO_WRAP);
            prefs().edit().putString(key, stored).apply();
            call.resolve();
        } catch (Exception error) {
            // 只报类型，不带 value
            call.reject("secure store write failed: " + error.getClass().getSimpleName());
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("key is required");
            return;
        }

        JSObject result = new JSObject();
        String stored = prefs().getString(key, null);
        if (stored == null) {
            result.put("value", null);
            call.resolve(result);
            return;
        }

        int separator = stored.indexOf(SEPARATOR);
        if (separator <= 0) {
            prefs().edit().remove(key).apply();
            result.put("value", null);
            call.resolve(result);
            return;
        }

        try {
            byte[] iv = Base64.decode(stored.substring(0, separator), Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(stored.substring(separator + 1), Base64.NO_WRAP);
            if (iv.length != GCM_IV_BYTES) throw new IllegalStateException("bad iv");

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plaintext = cipher.doFinal(ciphertext);
            result.put("value", new String(plaintext, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            // Keystore 密钥失效（恢复出厂、换锁屏方式等）后旧密文永远解不开：清掉并当作没有值，
            // 上层会退回未登录 / 重新填 Secret，不会卡在解密失败的死循环里。
            prefs().edit().remove(key).apply();
            result.put("value", null);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("key is required");
            return;
        }
        prefs().edit().remove(key).apply();
        call.resolve();
    }
}
