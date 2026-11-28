package com.homura.reader.toast

import android.app.Activity
import android.widget.Toast
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class ToastOptions {
  lateinit var message: String
}

@TauriPlugin
class AndroidToastPlugin(private val activity: Activity) : Plugin(activity) {
  private var activeToast: Toast? = null

  @Command
  fun show(invoke: Invoke) {
    try {
      val options = invoke.parseArgs(ToastOptions::class.java)
      activity.runOnUiThread {
        if (!activity.isFinishing && !activity.isDestroyed) {
          activeToast?.cancel()
          activeToast = Toast.makeText(activity.applicationContext, options.message, Toast.LENGTH_SHORT)
          activeToast?.show()
        }
      }
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Failed to show Android toast")
    }
  }
}
