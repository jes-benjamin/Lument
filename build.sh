#!/bin/bash
# ============================================================
# build.sh - Lument 跨平台构建脚本
# 用法:
#   ./build.sh cpp      - 构建 C++ 核心共享库
#   ./build.sh apk      - 构建 Android APK
#   ./build.sh web      - 打包 Web 版本
#   ./build.sh python   - 安装 Python 绑定
#   ./build.sh all      - 构建全部
#   ./build.sh clean    - 清理构建产物
# ============================================================
set -e

ENGINE_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${ENGINE_DIR}/build"
DIST_DIR="${ENGINE_DIR}/dist"

mkdir -p "${DIST_DIR}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[BUILD]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------- C++ 核心 ----------
build_cpp() {
    log "构建 C++ 核心引擎..."
    mkdir -p "${BUILD_DIR}"
    cd "${BUILD_DIR}"
    cmake .. -DCMAKE_BUILD_TYPE=Release 2>&1
    make -j$(nproc) 2>&1
    cp liblument.so "${DIST_DIR}/" 2>/dev/null || true
    log "C++ 核心构建完成: ${DIST_DIR}/liblument.so"
    ls -lh "${DIST_DIR}/liblument.so"
}

# ---------- Android APK ----------
build_apk() {
    log "构建 Android APK..."
    local SDK="${ANDROID_HOME:-/data/user/work/android-sdk}"
    local BT="${SDK}/build-tools/34.0.0"
    local PLATFORM="${SDK}/platforms/android-34/android.jar"

    if [ ! -f "${PLATFORM}" ]; then
        warn "android-34 未找到，尝试 android-33..."
        PLATFORM="${SDK}/platforms/android-33/android.jar"
    fi

    local PKG_DIR="${BUILD_DIR}/apk"
    mkdir -p "${PKG_DIR}/bin" "${PKG_DIR}/obj" "${PKG_DIR}/assets"

    # 1. 复制 Web 资源到 assets
    log "  复制游戏资源..."
    mkdir -p "${PKG_DIR}/assets/game"
    cp -r "${ENGINE_DIR}/game/"* "${PKG_DIR}/assets/game/"
    cp -r "${ENGINE_DIR}/runtime" "${PKG_DIR}/assets/"

    # 2. 创建 MainActivity（WebView 加载引擎运行时）
    log "  编译 Java..."
    mkdir -p "${PKG_DIR}/src/com/umbrella/world"
    cat > "${PKG_DIR}/src/com/umbrella/world/MainActivity.java" << 'JAVA'
package com.umbrella.world;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;
import android.content.Intent;
import android.net.Uri;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏设置
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        try {
            webView = new WebView(this);
            setContentView(webView);

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);
            settings.setDatabaseEnabled(true);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

            // 支持缩放（可选，关闭以保持像素风）
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    // 本地资源（file://）在WebView内加载，外部链接用系统浏览器打开
                    if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                        return true;
                    }
                    return false;
                }

                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    super.onReceivedError(view, errorCode, description, failingUrl);
                    Toast.makeText(MainActivity.this, "加载失败: " + description, Toast.LENGTH_LONG).show();
                }
            });
            webView.setWebChromeClient(new WebChromeClient());

            webView.loadUrl("file:///android_asset/game/index.html");
        } catch (Exception e) {
            Toast.makeText(this, "初始化失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            try {
                getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            } catch (Exception e) {
                // 忽略沉浸式设置的异常
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
JAVA

    javac -source 11 -target 11 -cp "${PLATFORM}" -d "${PKG_DIR}/obj" \
        "${PKG_DIR}/src/com/umbrella/world/MainActivity.java" 2>&1

    # 3. 打包 DEX（传入所有 .class 文件，包括匿名内部类）
    log "  生成 DEX..."
    find "${PKG_DIR}/obj" -name "*.class" > /tmp/d8_classes.txt
    "${BT}/d8" --release \
        --output "${PKG_DIR}/bin" \
        --lib "${PLATFORM}" \
        @/tmp/d8_classes.txt 2>&1

    # 4. 生成资源
    log "  生成资源..."
    mkdir -p "${PKG_DIR}/res/values"
    cat > "${PKG_DIR}/res/values/strings.xml" << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">遮伞世界</string>
</resources>
XML

    cat > "${PKG_DIR}/AndroidManifest.xml" << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.umbrella.world"
    android:versionCode="100"
    android:versionName="1.0.0">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <application
        android:label="@string/app_name"
        android:icon="@android:drawable/ic_menu_view"
        android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen"
        android:hardwareAccelerated="true"
        android:allowBackup="true">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:screenOrientation="landscape">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
XML

    # 5. 构建未签名 APK
    log "  打包 APK..."
    "${BT}/aapt" package -f \
        -M "${PKG_DIR}/AndroidManifest.xml" \
        -S "${PKG_DIR}/res" \
        -I "${PLATFORM}" \
        -A "${PKG_DIR}/assets" \
        -F "${PKG_DIR}/bin/app-unsigned.apk" 2>&1

    # 7. 添加 DEX
    cd "${PKG_DIR}/bin"
    zip -j app-unsigned.apk classes.dex 2>&1
    cd "${ENGINE_DIR}"

    # 8. 生成签名密钥（如果不存在）
    local KEYSTORE="${BUILD_DIR}/debug.keystore"
    if [ ! -f "${KEYSTORE}" ]; then
        log "  生成签名密钥..."
        keytool -genkey -v \
            -keystore "${KEYSTORE}" \
            -alias lument \
            -keyalg RSA -keysize 2048 \
            -validity 10000 \
            -storepass lument123 \
            -keypass lument123 \
            -dname "CN=Lument, OU=Game, O=Lument, L=CN, ST=CN, C=CN" 2>&1
    fi

    # 9. 签名 APK
    log "  签名 APK..."
    "${BT}/apksigner" sign \
        --ks "${KEYSTORE}" \
        --ks-key-alias lument \
        --ks-pass pass:lument123 \
        --key-pass pass:lument123 \
        --out "${DIST_DIR}/umbrella-world.apk" \
        "${PKG_DIR}/bin/app-unsigned.apk" 2>&1

    log "APK 构建完成: ${DIST_DIR}/umbrella-world.apk"
    ls -lh "${DIST_DIR}/umbrella-world.apk"
}

# ---------- Web 打包 ----------
build_web() {
    log "打包 Web 版本..."
    local WEB_DIR="${DIST_DIR}/web"
    mkdir -p "${WEB_DIR}/game" "${WEB_DIR}/runtime"

    cp -r "${ENGINE_DIR}/game/"* "${WEB_DIR}/game/"
    cp -r "${ENGINE_DIR}/runtime/"* "${WEB_DIR}/runtime/"

    # 修正 index.html 中的引擎路径
    sed 's|../runtime/js/lument.js|runtime/js/lument.js|g' \
        "${ENGINE_DIR}/game/index.html" > "${WEB_DIR}/index.html"

    cd "${DIST_DIR}"
    zip -r "umbrella-world-web.zip" web/ 2>&1
    cd "${ENGINE_DIR}"

    log "Web 版本打包完成: ${DIST_DIR}/umbrella-world-web.zip"
    ls -lh "${DIST_DIR}/umbrella-world-web.zip"
}

# ---------- Python 绑定 ----------
build_python() {
    log "安装 Python 绑定..."
    cd "${ENGINE_DIR}/bindings/python"
    pip install -e . --break-system-packages 2>&1 || warn "Python 绑定安装失败（可能缺少 liblument.so）"
    log "Python 绑定安装完成"
}

# ---------- 清理 ----------
clean_all() {
    log "清理构建产物..."
    rm -rf "${BUILD_DIR}" "${DIST_DIR}"
    log "清理完成"
}

# ---------- 主逻辑 ----------
case "${1:-all}" in
    cpp)     build_cpp ;;
    apk)     build_apk ;;
    web)     build_web ;;
    python)  build_python ;;
    all)
        build_cpp
        build_apk
        build_web
        ;;
    clean)   clean_all ;;
    *)
        echo "用法: $0 {cpp|apk|web|python|all|clean}"
        exit 1
        ;;
esac

log "全部完成!"
