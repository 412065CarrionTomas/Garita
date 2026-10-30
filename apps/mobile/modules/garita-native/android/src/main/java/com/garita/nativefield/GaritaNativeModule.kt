package com.garita.nativefield

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.telephony.SmsManager
import java.util.concurrent.ConcurrentHashMap
import java.util.UUID
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean

class GaritaNativeModule : Module() {
  private val smsReceivers = ConcurrentHashMap.newKeySet<BroadcastReceiver>()
  private val smsContext: Context
    get() = appContext.reactContext ?: error("Contexto no disponible")

  private fun canSendSms(): Boolean =
    ContextCompat.checkSelfPermission(smsContext, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED &&
      smsContext.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING)

  private fun removeSmsReceiver(receiver: BroadcastReceiver) {
    if (smsReceivers.remove(receiver)) smsContext.unregisterReceiver(receiver)
  }

  private val fallbackBootId = "process:" + UUID.randomUUID().toString()
  override fun definition() = ModuleDefinition {
    Name("GaritaNative")
    Events("onSmsStatus")
    OnDestroy {
      smsReceivers.toList().forEach { removeSmsReceiver(it) }
    }
    AsyncFunction("getSmsCapability") { mapOf("canSendInBackground" to canSendSms()) }
    AsyncFunction("sendSms") { options: Map<String, String>, promise: Promise ->
      val destination = options["destination"] ?: ""
      val message = options["message"] ?: ""
      if (!Regex("^\\+[1-9]\\d{1,14}$").matches(destination) || message.isEmpty() || message.length > 160 ||
        !Regex("^[A-Za-z0-9 .,:/?=\\-]+$").matches(message)) {
        promise.reject("INVALID_SMS", "Destino o mensaje de pánico inválido", null)
        return@AsyncFunction
      }
      if (!canSendSms()) {
        promise.reject("SMS_UNAVAILABLE", "Se requiere permiso SMS y telefonía", null)
        return@AsyncFunction
      }
      val id = UUID.randomUUID().toString()
      val context = smsContext
      val sentAction = "${context.packageName}.SMS_SENT_$id"
      val deliveredAction = "${context.packageName}.SMS_DELIVERED_$id"
      val delivered = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          removeSmsReceiver(this)
          sendEvent("onSmsStatus", mapOf("id" to id, "status" to if (resultCode == Activity.RESULT_OK) "delivered" else "failed"))
        }
      }
      val sent = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          removeSmsReceiver(this)
          if (resultCode != Activity.RESULT_OK) removeSmsReceiver(delivered)
          sendEvent("onSmsStatus", mapOf("id" to id, "status" to if (resultCode == Activity.RESULT_OK) "sent" else "failed"))
        }
      }
      try {
        for ((receiver, action) in listOf(sent to sentAction, delivered to deliveredAction)) {
          ContextCompat.registerReceiver(context, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
          smsReceivers.add(receiver)
        }
        val flags = PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        val sentIntent = PendingIntent.getBroadcast(context, 0, Intent(sentAction).setPackage(context.packageName), flags)
        val deliveredIntent = PendingIntent.getBroadcast(context, 0, Intent(deliveredAction).setPackage(context.packageName), flags)
        val manager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) context.getSystemService(SmsManager::class.java) else legacySmsManager()
        manager.sendTextMessage(destination, null, message, sentIntent, deliveredIntent)
        promise.resolve(mapOf("id" to id))
      } catch (error: Exception) {
        removeSmsReceiver(sent)
        removeSmsReceiver(delivered)
        promise.reject("SMS_SEND_FAILED", "No se pudo enviar el SMS", error)
      }
    }
    AsyncFunction("getCapabilities") {
      mapOf("moduleVersion" to "1.1.0", "simulationDetectionAvailable" to true)
    }
    AsyncFunction("getMonotonicClock") {
      val bootId = try {
        val context = appContext.reactContext ?: error("Contexto no disponible")
        "android:" + Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT)
      } catch (_: Exception) {
        // shortcut: without BOOT_COUNT each process is a new boot, upgrade when the device exposes a stable boot identifier.
        fallbackBootId
      }
      mapOf("elapsedMs" to SystemClock.elapsedRealtime().toDouble(), "bootId" to bootId)
    }
    AsyncFunction("getCurrentLocation") { options: Map<String, Any>, promise: Promise ->
      val timeoutMs = (options["timeoutMs"] as? Number)?.toLong() ?: 5000L
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("LOCATION_UNAVAILABLE", "Contexto no disponible", null)
        return@AsyncFunction
      }
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("PERMISSION_DENIED", "Se requiere ubicación precisa", null)
        return@AsyncFunction
      }

      val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      val provider = when {
        manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        else -> {
          promise.reject("LOCATION_UNAVAILABLE", "Servicios de ubicación apagados", null)
          return@AsyncFunction
        }
      }

      val handler = Handler(Looper.getMainLooper())
      val settled = AtomicBoolean(false)
      lateinit var listener: LocationListener
      lateinit var timeout: Runnable
      fun settle(action: () -> Unit) {
        if (!settled.compareAndSet(false, true)) return
        handler.removeCallbacks(timeout)
        try {
          manager.removeUpdates(listener)
        } catch (_: SecurityException) {
          // A permission can be revoked after the request starts.
        }
        action()
      }

      listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
          settle {
            val simulation = if (Build.VERSION.SDK_INT >= 31) location.isMock else isLegacyMockLocation(location)
            val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
              timeZone = TimeZone.getTimeZone("UTC")
            }
            promise.resolve(
              mapOf(
                "latitude" to location.latitude,
                "longitude" to location.longitude,
                "accuracyMeters" to location.accuracy.toDouble(),
                "timestamp" to formatter.format(Date(location.time)),
                "simulation" to if (simulation) "simulated" else "not_simulated",
              ),
            )
          }
        }

        @Deprecated("Required by LocationListener")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
      }
      timeout = Runnable {
        settle { promise.reject("LOCATION_TIMEOUT", "Tiempo de espera agotado", null) }
      }

      handler.postDelayed(timeout, timeoutMs)
      try {
        manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
      } catch (error: SecurityException) {
        settle { promise.reject("PERMISSION_DENIED", error.message ?: "Se requiere permiso de ubicación precisa", error) }
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun legacySmsManager(): SmsManager = SmsManager.getDefault()

  @Suppress("DEPRECATION")
  private fun isLegacyMockLocation(location: Location): Boolean = location.isFromMockProvider
}
