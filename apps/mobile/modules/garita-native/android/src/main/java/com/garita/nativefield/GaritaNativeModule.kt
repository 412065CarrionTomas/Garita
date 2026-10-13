package com.garita.nativefield

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
  override fun definition() = ModuleDefinition {
    Name("GaritaNative")
    AsyncFunction("getCapabilities") {
      mapOf("moduleVersion" to "1.0.0", "simulationDetectionAvailable" to true)
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
  private fun isLegacyMockLocation(location: Location): Boolean = location.isFromMockProvider
}
