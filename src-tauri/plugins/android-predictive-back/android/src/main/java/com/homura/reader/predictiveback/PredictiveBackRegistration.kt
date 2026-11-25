package com.homura.reader.predictiveback

import android.app.Activity
import android.os.Build
import android.os.SystemClock
import android.window.BackEvent
import android.window.OnBackAnimationCallback
import android.window.OnBackInvokedDispatcher

@android.annotation.TargetApi(34)
object PredictiveBackRegistration {
  fun register(
    activity: Activity,
    dispatch: (String, Float, Int, Float, Float, Long) -> Unit
  ): OnBackAnimationCallback {
    val callback = object : OnBackAnimationCallback {
      override fun onBackStarted(backEvent: BackEvent) {
        dispatchEvent("started", backEvent, dispatch)
      }

      override fun onBackProgressed(backEvent: BackEvent) {
        dispatchEvent("progressed", backEvent, dispatch)
      }

      override fun onBackCancelled() {
        dispatch("cancelled", Float.NaN, -1, Float.NaN, Float.NaN, SystemClock.uptimeMillis())
      }

      override fun onBackInvoked() {
        dispatch("invoked", Float.NaN, -1, Float.NaN, Float.NaN, SystemClock.uptimeMillis())
      }
    }

    activity.window.onBackInvokedDispatcher.registerOnBackInvokedCallback(
      OnBackInvokedDispatcher.PRIORITY_DEFAULT,
      callback
    )
    return callback
  }

  fun unregister(activity: Activity, callback: Any) {
    activity.window.onBackInvokedDispatcher.unregisterOnBackInvokedCallback(
      callback as OnBackAnimationCallback
    )
  }

  private fun dispatchEvent(
    phase: String,
    event: BackEvent,
    dispatch: (String, Float, Int, Float, Float, Long) -> Unit
  ) {
    // BackEvent 的帧时间从 API 36 才可用，旧版本沿用同一 uptime 时钟。
    val frameTime = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) event.frameTimeMillis else 0L
    dispatch(
      phase,
      event.progress,
      event.swipeEdge,
      event.touchX,
      event.touchY,
      if (frameTime > 0) frameTime else SystemClock.uptimeMillis()
    )
  }
}
