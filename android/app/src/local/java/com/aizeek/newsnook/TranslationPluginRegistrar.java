package com.aizeek.newsnook;

import com.getcapacitor.BridgeActivity;

/** 本地翻译版在 Bridge 创建前注册 ML Kit 与站点原生插件。 */
final class TranslationPluginRegistrar {
    private TranslationPluginRegistrar() {}

    static void register(BridgeActivity activity) {
        activity.registerPlugin(MlKitTranslationPlugin.class);
        activity.registerPlugin(BergamotTranslationPlugin.class);
        activity.registerPlugin(ZhihuAuthPlugin.class);
    }
}
