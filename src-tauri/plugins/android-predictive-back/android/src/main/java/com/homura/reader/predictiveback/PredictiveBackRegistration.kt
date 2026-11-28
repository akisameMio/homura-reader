package com.homura.reader.predictiveback

import android.app.Activity
import android.os.Build
import android.os.SystemClock
import android.window.BackEvent
import android.window.OnBackAnimationCallback
import android.window.OnBackInvokedDispatcher

@android.annotation.TargetApi(36)
private object BackEventApi36 {
  fun frameTimeMillis(event: BackEvent): Long {
    return try {
      event.frameTimeMillis
    } catch (_: Throwable) {
      0L
    }
  }
}

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
        try {
          dispatch("cancelled", Float.NaN, -1, Float.NaN, Float.NaN, SystemClock.uptimeMillis())
        } catch (_: Throwable) {}
      }

      override fun onBackInvoked() {
        try {
          dispatch("invoked", Float.NaN, -1, Float.NaN, Float.NaN, SystemClock.uptimeMillis())
        } catch (_: Throwable) {}
      }
    }

    activity.onBackInvokedDispatcher.registerOnBackInvokedCallback(
      OnBackInvokedDispatcher.PRIORITY_OVERLAY,
      callback
    )
    return callback
  }

  fun unregister(activity: Activity, callback: Any) {
    try {
      activity.onBackInvokedDispatcher.unregisterOnBackInvokedCallback(
        callback as OnBackAnimationCallback
      )
    } catch (_: Throwable) {
      // Activity 销毁或重复注销时忽略底层分发器异常
    }
  }

  private fun dispatchEvent(
    phase: String,
    event: BackEvent,
    dispatch: (String, Float, Int, Float, Float, Long) -> Unit
  ) {
    try {
      // BackEvent.frameTimeMillis 仅在 API 36 可用，隔离到独立对象避免 Android 14/15 ART 校验异常。
      val frameTime = if (Build.VERSION.SDK_INT >= 36) BackEventApi36.frameTimeMillis(event) else 0L
      dispatch(
        phase,
        event.progress,
        event.swipeEdge,
        event.touchX,
        event.touchY,
        if (frameTime > 0) frameTime else SystemClock.uptimeMillis()
      )
    } catch (_: Throwable) {
      // 部分定制 ROM 在极端边缘手势下可能抛出 BackEvent 读取异常，兜底防止进程闪退。
    }
  }
}
