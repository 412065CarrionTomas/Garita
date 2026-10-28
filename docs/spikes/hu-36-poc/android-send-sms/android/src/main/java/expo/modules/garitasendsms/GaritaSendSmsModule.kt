package expo.modules.garitasendsms

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class GaritaSendSmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React Context no disponible")

  private var sentReceiver: BroadcastReceiver? = null
  private var deliveredReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("GaritaSendSms")

    Events("onSmsSent", "onSmsDelivered")

    Function("hasPermission") {
      val permissionCheck = ContextCompat.checkSelfPermission(
        context,
        android.Manifest.permission.SEND_SMS
      )
      permissionCheck == PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction("sendSmsInBackground") { phoneNumber: String, messageText: String, promise: Promise ->
      val hasPermission = ContextCompat.checkSelfPermission(
        context,
        android.Manifest.permission.SEND_SMS
      ) == PackageManager.PERMISSION_GRANTED

      if (!hasPermission) {
        promise.reject("PERMISSION_DENIED", "El permiso SEND_SMS no fue concedido", null)
        return@AsyncFunction
      }

      val messageId = UUID.randomUUID().toString().substring(0, 8)
      val actionSent = "expo.modules.garitasendsms.SMS_SENT_$messageId"
      val actionDelivered = "expo.modules.garitasendsms.SMS_DELIVERED_$messageId"

      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }

      val sentPendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(actionSent),
        flags
      )

      val deliveredPendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(actionDelivered),
        flags
      )

      // Receptor de confirmación de envío (celular -> torre celular / SMSC)
      val localSentReceiver = object : BroadcastReceiver() {
        override fun onReceive(recvContext: Context?, intent: Intent?) {
          try {
            context.unregisterReceiver(this)
          } catch (e: Exception) {
            // Ya desregistrado
          }

          val status = when (resultCode) {
            Activity.RESULT_OK -> "OK"
            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "GENERIC_FAILURE"
            SmsManager.RESULT_ERROR_NO_SERVICE -> "NO_SERVICE"
            SmsManager.RESULT_ERROR_NULL_PDU -> "NULL_PDU"
            SmsManager.RESULT_ERROR_RADIO_OFF -> "RADIO_OFF"
            else -> "UNKNOWN_ERROR_$resultCode"
          }

          sendEvent("onSmsSent", mapOf(
            "messageId" to messageId,
            "phoneNumber" to phoneNumber,
            "status" to status,
            "resultCode" to resultCode,
            "timestamp" to System.currentTimeMillis()
          ))
        }
      }

      // Receptor de confirmación de entrega (SMSC -> celular de destino)
      val localDeliveredReceiver = object : BroadcastReceiver() {
        override fun onReceive(recvContext: Context?, intent: Intent?) {
          try {
            context.unregisterReceiver(this)
          } catch (e: Exception) {
            // Ya desregistrado
          }

          val isDelivered = resultCode == Activity.RESULT_OK

          sendEvent("onSmsDelivered", mapOf(
            "messageId" to messageId,
            "phoneNumber" to phoneNumber,
            "delivered" to isDelivered,
            "resultCode" to resultCode,
            "timestamp" to System.currentTimeMillis()
          ))
        }
      }

      // Registro con compatibilidad Android 14+ (RECEIVER_NOT_EXPORTED)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(
          localSentReceiver,
          IntentFilter(actionSent),
          Context.RECEIVER_NOT_EXPORTED
        )
        context.registerReceiver(
          localDeliveredReceiver,
          IntentFilter(actionDelivered),
          Context.RECEIVER_NOT_EXPORTED
        )
      } else {
        context.registerReceiver(localSentReceiver, IntentFilter(actionSent))
        context.registerReceiver(localDeliveredReceiver, IntentFilter(actionDelivered))
      }

      try {
        val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          context.getSystemService(SmsManager::class.java)
        } else {
          @Suppress("DEPRECATION")
          SmsManager.getDefault()
        }

        // Para mensajes cortos (< 160 caracteres GSM 7-bit) se envía directamente un solo segmento
        smsManager.sendTextMessage(
          phoneNumber,
          null,
          messageText,
          sentPendingIntent,
          deliveredPendingIntent
        )

        promise.resolve(mapOf(
          "messageId" to messageId,
          "dispatched" to true,
          "charLength" to messageText.length
        ))
      } catch (e: Exception) {
        try {
          context.unregisterReceiver(localSentReceiver)
          context.unregisterReceiver(localDeliveredReceiver)
        } catch (_: Exception) {}
        promise.reject("SMS_SEND_FAILED", e.message, e)
      }
    }
  }
}
