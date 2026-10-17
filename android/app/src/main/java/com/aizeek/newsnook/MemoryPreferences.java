package com.aizeek.newsnook;

import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Process-local preferences for a private browser session. Never opens a file. */
final class MemoryPreferences implements SharedPreferences {
    private final Map<String, Object> values = new HashMap<>();
    private final Set<OnSharedPreferenceChangeListener> listeners = new HashSet<>();

    @Override public synchronized Map<String, ?> getAll() { return new HashMap<>(values); }
    @Override public synchronized String getString(String key, String fallback) {
        Object value = values.get(key); return value instanceof String ? (String) value : fallback;
    }
    @Override @SuppressWarnings("unchecked")
    public synchronized Set<String> getStringSet(String key, Set<String> fallback) {
        Object value = values.get(key);
        return value instanceof Set ? new HashSet<>((Set<String>) value) : fallback;
    }
    @Override public synchronized int getInt(String key, int fallback) {
        Object value = values.get(key); return value instanceof Integer ? (Integer) value : fallback;
    }
    @Override public synchronized long getLong(String key, long fallback) {
        Object value = values.get(key); return value instanceof Long ? (Long) value : fallback;
    }
    @Override public synchronized float getFloat(String key, float fallback) {
        Object value = values.get(key); return value instanceof Float ? (Float) value : fallback;
    }
    @Override public synchronized boolean getBoolean(String key, boolean fallback) {
        Object value = values.get(key); return value instanceof Boolean ? (Boolean) value : fallback;
    }
    @Override public synchronized boolean contains(String key) { return values.containsKey(key); }
    @Override public Editor edit() { return new MemoryEditor(); }
    @Override public synchronized void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {
        listeners.add(listener);
    }
    @Override public synchronized void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {
        listeners.remove(listener);
    }

    private final class MemoryEditor implements Editor {
        private final Map<String, Object> changes = new HashMap<>();
        private boolean clear;
        @Override public Editor putString(String key, String value) { changes.put(key, value); return this; }
        @Override public Editor putStringSet(String key, Set<String> value) {
            changes.put(key, value == null ? null : new HashSet<>(value)); return this;
        }
        @Override public Editor putInt(String key, int value) { changes.put(key, value); return this; }
        @Override public Editor putLong(String key, long value) { changes.put(key, value); return this; }
        @Override public Editor putFloat(String key, float value) { changes.put(key, value); return this; }
        @Override public Editor putBoolean(String key, boolean value) { changes.put(key, value); return this; }
        @Override public Editor remove(String key) { changes.put(key, null); return this; }
        @Override public Editor clear() { clear = true; return this; }
        @Override public void apply() { commit(); }
        @Override public boolean commit() {
            List<OnSharedPreferenceChangeListener> callbacks;
            Set<String> changed = new HashSet<>(changes.keySet());
            synchronized (MemoryPreferences.this) {
                if (clear) { changed.addAll(values.keySet()); values.clear(); }
                for (Map.Entry<String, Object> entry : changes.entrySet()) {
                    if (entry.getValue() == null) values.remove(entry.getKey());
                    else values.put(entry.getKey(), entry.getValue());
                }
                callbacks = new ArrayList<>(listeners);
            }
            for (String key : changed) for (OnSharedPreferenceChangeListener listener : callbacks)
                listener.onSharedPreferenceChanged(MemoryPreferences.this, key);
            return true;
        }
    }
}
