package com.aizeek.newsnook;

import com.getcapacitor.BridgeActivity;

/** 轻量云翻译版不注册本地翻译插件；站点原生能力在这里统一注册。 */
final class TranslationPluginRegistrar {
    private TranslationPluginRegistrar() {}

    static void register(BridgeActivity activity) {
        activity.registerPlugin(ZhihuAuthPlugin.class);
    }
}
