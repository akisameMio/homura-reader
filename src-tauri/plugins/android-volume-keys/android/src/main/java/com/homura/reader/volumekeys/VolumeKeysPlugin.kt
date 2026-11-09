package com.homura.reader.volumekeys

import android.app.Activity
import android.view.KeyEvent
import android.view.View
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class EnableOptions {
  lateinit var handler: Channel
}

@TauriPlugin
class VolumeKeysPlugin(private val activity: Activity) : Plugin(activity) {
  private var channel: Channel? = null
  private var webViewRef: WebView? = null

  private val webViewKeyListener = View.OnKeyListener { _, keyCode, event ->
    handleKeyEvent(keyCode, event)
  }
  private val decorKeyListener = View.OnKeyListener { _, keyCode, event ->
    handleKeyEvent(keyCode, event)
  }

  override fun load(webView: WebView) {
    webViewRef = webView
    // 音量键先交给当前焦点视图，WebView 持有焦点时按键不会走到 Activity.onKeyDown，
    // 因此监听必须挂在 WebView 上；DecorView 只在 WebView 意外失焦时兜底。
    webView.setOnKeyListener(webViewKeyListener)
    activity.window?.decorView?.setOnKeyListener(decorKeyListener)
  }

  // WebView 重建 / 插件销毁时清掉监听，避免旧实例继续吞音量键。
  override fun onDestroy(activity: AppCompatActivity) {
    webViewRef?.setOnKeyListener(null)
    activity.window?.decorView?.setOnKeyListener(null)
    webViewRef = null
    channel = null
    super.onDestroy(activity)
  }

  private fun handleKeyEvent(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode != KeyEvent.KEYCODE_VOLUME_UP && keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
      return false
    }
    val handler = channel ?: return false
    // 只响应首次按下，长按产生的重复事件不连续翻页
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
      val payload = JSObject().apply {
        put("direction", if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) "prev" else "next")
      }
      handler.send(payload)
    }
    // 开启期间连按下带抬起一起吞掉，避免同时触发系统音量条
    return true
  }

  @Command
  fun enable(invoke: Invoke) {
    try {
      channel = invoke.parseArgs(EnableOptions::class.java).handler
      // 音量键只派发给拥有焦点的窗口内视图；冷启动后 WebView 可能还没拿到焦点，
      // 主动请求焦点，保证打开书后不用先点一下屏幕也能用音量键翻页。
      webViewRef?.requestFocus()
      invoke.resolve()
    } catch (ex: Exception) {
      channel = null
      invoke.reject(ex.message ?: "Failed to enable volume key paging")
    }
  }

  @Command
  fun disable(invoke: Invoke) {
    channel = null
    invoke.resolve()
  }
}
