package com.rmpg.forensics

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.bottomnavigation.BottomNavigationView
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "RMPGForensics"
        private const val ACTION_USB_PERMISSION = "com.rmpg.forensics.USB_PERMISSION"
        private const val BASE_URL = "file:///android_asset/"
    }

    private lateinit var webView: WebView
    private lateinit var bottomNav: BottomNavigationView
    private lateinit var usbManager: UsbManager

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var fileChooserLauncher: ActivityResultLauncher<Intent>

    // USB broadcast receiver for device attach/detach events
    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    }
                    device?.let {
                        Log.i(TAG, "USB device attached: ${it.deviceName}")
                        requestUsbPermission(it)
                        notifyWebView("usb_device_attached", getDeviceInfoJson(it))
                    }
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    }
                    device?.let {
                        Log.i(TAG, "USB device detached: ${it.deviceName}")
                        notifyWebView("usb_device_detached", getDeviceInfoJson(it))
                    }
                }
                ACTION_USB_PERMISSION -> {
                    synchronized(this) {
                        val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                        } else {
                            @Suppress("DEPRECATION")
                            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                        }
                        val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                        if (granted && device != null) {
                            Log.i(TAG, "USB permission granted for: ${device.deviceName}")
                            notifyWebView("usb_permission_granted", getDeviceInfoJson(device))
                        } else {
                            Log.w(TAG, "USB permission denied for device")
                            notifyWebView("usb_permission_denied", JSONObject())
                        }
                    }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        usbManager = getSystemService(Context.USB_SERVICE) as UsbManager

        setupFileChooser()
        setupWebView()
        setupBottomNavigation()
        registerUsbReceiver()

        // Check for already connected USB devices
        checkConnectedDevices()
    }

    private fun setupFileChooser() {
        fileChooserLauncher = registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            if (result.resultCode == RESULT_OK) {
                val data = result.data
                val results: Array<Uri>? = when {
                    data?.clipData != null -> {
                        val clipData = data.clipData!!
                        Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
                    }
                    data?.data != null -> arrayOf(data.data!!)
                    else -> null
                }
                fileUploadCallback?.onReceiveValue(results ?: arrayOf())
            } else {
                fileUploadCallback?.onReceiveValue(arrayOf())
            }
            fileUploadCallback = null
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = findViewById(R.id.webView)

        webView.settings.apply {
            // JavaScript and DOM
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true

            // File access
            allowFileAccess = true
            allowContentAccess = true

            // Display settings
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)

            // Cache and storage
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

            // Media
            mediaPlaybackRequiresUserGesture = false

            // Performance
            javaScriptCanOpenWindowsAutomatically = true

            // User agent
            userAgentString = "$userAgentString RMPGForensics/1.0.0"
        }

        // Add JavaScript interface for native bridge
        webView.addJavascriptInterface(WebAppInterface(this), "AndroidBridge")

        // WebView client to handle navigation within the app
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                // Keep asset URLs and localhost in the WebView
                return if (url.startsWith("file:///android_asset/") ||
                    url.startsWith("http://localhost") ||
                    url.startsWith("https://localhost")
                ) {
                    false
                } else {
                    // Open external URLs in the system browser
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    true
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "Page loaded: $url")
                // Inject connected device info after page load
                checkConnectedDevices()
            }
        }

        // WebChromeClient for file picker and console logging
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback

                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                }

                try {
                    fileChooserLauncher.launch(intent)
                } catch (e: Exception) {
                    Log.e(TAG, "File chooser failed", e)
                    fileUploadCallback?.onReceiveValue(arrayOf())
                    fileUploadCallback = null
                    return false
                }
                return true
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    Log.d(TAG, "WebView Console [${it.messageLevel()}]: ${it.message()} " +
                            "(${it.sourceId()}:${it.lineNumber()})")
                }
                return true
            }
        }

        // Load the initial page
        loadPage("index.html")
    }

    private fun setupBottomNavigation() {
        bottomNav = findViewById(R.id.bottomNavigation)
        bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_dashboard -> {
                    loadPage("index.html")
                    true
                }
                R.id.nav_android -> {
                    loadPage("index.html#/android")
                    true
                }
                R.id.nav_whatsapp -> {
                    loadPage("index.html#/whatsapp")
                    true
                }
                R.id.nav_tools -> {
                    loadPage("index.html#/tools")
                    true
                }
                R.id.nav_settings -> {
                    loadPage("index.html#/settings")
                    true
                }
                else -> false
            }
        }
    }

    private fun loadPage(path: String) {
        // Try to load from renderer directory first (Electron build output),
        // fall back to root assets
        val rendererPath = "renderer/$path"
        val assetExists = try {
            assets.open(rendererPath).close()
            true
        } catch (e: Exception) {
            false
        }

        val url = if (assetExists) {
            "${BASE_URL}renderer/$path"
        } else {
            "${BASE_URL}$path"
        }

        webView.loadUrl(url)
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private fun registerUsbReceiver() {
        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
            addAction(ACTION_USB_PERMISSION)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(usbReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(usbReceiver, filter)
        }
    }

    private fun requestUsbPermission(device: UsbDevice) {
        val permissionIntent = PendingIntent.getBroadcast(
            this, 0,
            Intent(ACTION_USB_PERMISSION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        usbManager.requestPermission(device, permissionIntent)
    }

    private fun checkConnectedDevices() {
        val deviceList = usbManager.deviceList
        if (deviceList.isNotEmpty()) {
            val devicesArray = JSONArray()
            for ((_, device) in deviceList) {
                devicesArray.put(getDeviceInfoJson(device))
            }
            notifyWebView("usb_devices_found", JSONObject().put("devices", devicesArray))
        }
    }

    private fun getDeviceInfoJson(device: UsbDevice): JSONObject {
        return JSONObject().apply {
            put("deviceName", device.deviceName)
            put("vendorId", device.vendorId)
            put("productId", device.productId)
            put("deviceClass", device.deviceClass)
            put("deviceSubclass", device.deviceSubclass)
            put("deviceProtocol", device.deviceProtocol)
            put("interfaceCount", device.interfaceCount)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                put("manufacturerName", device.manufacturerName ?: "Unknown")
                put("productName", device.productName ?: "Unknown")
                put("serialNumber", device.serialNumber ?: "Unknown")
            }
        }
    }

    private fun notifyWebView(event: String, data: JSONObject) {
        runOnUiThread {
            val js = "javascript:if(window.onNativeEvent){window.onNativeEvent('$event', ${data.toString().replace("'", "\\'")});}"
            webView.evaluateJavascript(js, null)
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(usbReceiver)
        } catch (e: Exception) {
            Log.w(TAG, "USB receiver already unregistered")
        }
        webView.destroy()
        super.onDestroy()
    }

    /**
     * JavaScript interface exposed to the WebView as `window.AndroidBridge`
     */
    inner class WebAppInterface(private val context: Context) {

        @JavascriptInterface
        fun getAppVersion(): String {
            return "1.0.0"
        }

        @JavascriptInterface
        fun getPlatform(): String {
            return "android"
        }

        @JavascriptInterface
        fun getAndroidVersion(): String {
            return Build.VERSION.RELEASE
        }

        @JavascriptInterface
        fun getDeviceModel(): String {
            return "${Build.MANUFACTURER} ${Build.MODEL}"
        }

        @JavascriptInterface
        fun getConnectedUsbDevices(): String {
            val devicesArray = JSONArray()
            val deviceList = usbManager.deviceList
            for ((_, device) in deviceList) {
                devicesArray.put(getDeviceInfoJson(device))
            }
            return devicesArray.toString()
        }

        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun navigateTo(tab: String) {
            runOnUiThread {
                when (tab) {
                    "dashboard" -> bottomNav.selectedItemId = R.id.nav_dashboard
                    "android" -> bottomNav.selectedItemId = R.id.nav_android
                    "whatsapp" -> bottomNav.selectedItemId = R.id.nav_whatsapp
                    "tools" -> bottomNav.selectedItemId = R.id.nav_tools
                    "settings" -> bottomNav.selectedItemId = R.id.nav_settings
                }
            }
        }

        @JavascriptInterface
        fun hasUsbHostSupport(): Boolean {
            return packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_USB_HOST)
        }
    }
}
