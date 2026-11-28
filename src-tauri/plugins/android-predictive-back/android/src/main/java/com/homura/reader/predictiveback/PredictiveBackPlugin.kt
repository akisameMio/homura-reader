package com.homura.reader.predictiveback

import android.app.Activity
import android.os.Build
import android.os.SystemClock
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

private const val NATIVE_FALLBACK_DEDUP_MS = 150L

@InvokeArg
class EnableOptions {
  var handler: Channel? = null
}

@TauriPlugin
class PredictiveBackPlugin(private val activity: Activity) : Plugin(activity) {
  @Volatile
  private var channel: Channel? = null
  private var callback: Any? = null
  private var fallbackBackCallback: OnBackPressedCallback? = null
  private var enabled: Boolean = false
  private var lastNativeInvokedAtMs: Long = 0L

  @Command
  fun supported(invoke: Invoke) {
    val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
    invoke.resolve(JSObject().put("supported", supported))
  }

  @Command
  fun enable(invoke: Invoke) {
    val options = try {
      invoke.parseArgs(EnableOptions::class.java)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Failed to parse predictive back options")
      return
    }
    val nextHandler = options.handler
    activity.runOnUiThread {
      try {
        if (activity.isFinishing || activity.isDestroyed) {
          invoke.reject("Activity is finishing")
          return@runOnUiThread
        }
        nextHandler?.let { channel = it }
        checkNotNull(channel) { "Predictive back channel is missing" }

        enabled = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          registerCallback(refresh = true)
        }
        attachFallbackCallback()
        invoke.resolve()
      } catch (ex: Exception) {
        enabled = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          unregisterCallback()
        }
        detachFallbackCallback()
        invoke.reject(ex.message ?: "Failed to enable predictive back")
      }
    }
  }

  @Command
  fun disable(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        enabled = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          unregisterCallback()
        }
        detachFallbackCallback()
        invoke.resolve()
      } catch (ex: Exception) {
        invoke.reject(ex.message ?: "Failed to disable predictive back")
      }
    }
  }

  @android.annotation.TargetApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  private fun registerCallback(refresh: Boolean = false) {
    if (callback != null) {
      if (!refresh) return
      unregisterCallback()
    }
    callback = PredictiveBackRegistration.register(activity) { phase, progress, swipeEdge, touchX, touchY, frameTimeMillis ->
      if (phase == "invoked") {
        lastNativeInvokedAtMs = SystemClock.uptimeMillis()
      }
      dispatch(phase, progress, swipeEdge, touchX, touchY, frameTimeMillis)
    }
  }

  @android.annotation.TargetApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  private fun unregisterCallback() {
    val current = callback ?: return
    PredictiveBackRegistration.unregister(activity, current)
    callback = null
  }

  // 部分 Android 14/15/16 ROM 在三键返回或跳过 OnBackAnimationCallback 时会落到
  // OnBackPressedDispatcher；启用期间在栈顶挂一层兜底，避免漏到 AppPlugin 直接退出应用。
  private fun attachFallbackCallback() {
    detachFallbackCallback()
    val appCompat = activity as? AppCompatActivity ?: return
    val fallback = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (!enabled) {
          isEnabled = false
          appCompat.onBackPressedDispatcher.onBackPressed()
          return
        }
        val now = SystemClock.uptimeMillis()
        if (now - lastNativeInvokedAtMs < NATIVE_FALLBACK_DEDUP_MS) {
          return
        }
        dispatch("invoked", Float.NaN, -1, Float.NaN, Float.NaN, now)
      }
    }
    appCompat.onBackPressedDispatcher.addCallback(fallback)
    fallbackBackCallback = fallback
  }

  private fun detachFallbackCallback() {
    fallbackBackCallback?.remove()
    fallbackBackCallback = null
  }

  override fun onResume(activity: AppCompatActivity) {
    super.onResume(activity)
    if (enabled) {
      // AndroidX 会在 onStart/onResume 重排返回回调，这里重新置顶继续消费返回手势。
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        registerCallback(refresh = true)
      }
      attachFallbackCallback()
    }
  }

  override fun onDestroy(activity: AppCompatActivity) {
    enabled = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      unregisterCallback()
    }
    detachFallbackCallback()
    channel = null
    super.onDestroy(activity)
  }

  private fun dispatch(
    phase: String,
    progress: Float = Float.NaN,
    swipeEdge: Int = -1,
    touchX: Float = Float.NaN,
    touchY: Float = Float.NaN,
    frameTimeMillis: Long = 0
  ) {
    val payload = JSObject().apply {
      put("phase", phase)
      put("frameTimeMillis", frameTimeMillis)
      if (!progress.isNaN()) {
        put("progress", progress.toDouble())
        put("swipeEdge", swipeEdge)
        put("touchX", touchX.toDouble())
        put("touchY", touchY.toDouble())
      }
    }
    channel?.send(payload)
  }
}
