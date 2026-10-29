package com.north.device

import android.content.Intent
import android.net.ConnectivityManager
import android.net.VpnService
import android.os.ParcelFileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Split-tunnel DNS only. No TLS interception, certificate installation or traffic logs. */
class NorthDnsService : VpnService() {
  companion object { @Volatile var running = false }
  private var tunnel: ParcelFileDescriptor? = null
  private var worker: Thread? = null
  private val network = Executors.newSingleThreadScheduledExecutor()
  override fun onStartCommand(intent: Intent?, flags: Int, id: Int): Int {
    if (running || NorthStore.owner(this).isBlank()) return START_NOT_STICKY
    val manager = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
    val upstream = manager.getLinkProperties(manager.activeNetwork)?.dnsServers?.firstOrNull() ?: InetAddress.getByName("1.1.1.1")
    notification(this, 42, "North website blocking is on", "Local DNS filter. Manage or disconnect in North.")
    tunnel = Builder().setSession("North website blocking").addAddress("10.111.0.1", 32).addDnsServer("10.111.0.2").addRoute("10.111.0.2", 32).setMtu(1500).setBlocking(true).establish()
    val descriptor = tunnel ?: run { stopSelf(); return START_NOT_STICKY }
    running = true
    network.scheduleWithFixedDelay({ NorthStore.sync(this) }, 0, 30, TimeUnit.SECONDS)
    worker = Thread {
      try {
        val input = FileInputStream(descriptor.fileDescriptor); val output = FileOutputStream(descriptor.fileDescriptor)
        val packet = ByteArray(32767)
        while (running) {
          val count = input.read(packet); if (count < 28 || packet[0].toInt() ushr 4 != 4 || packet[9].toInt() != 17) continue
          val header = (packet[0].toInt() and 15) * 4
          if (header + 8 + 12 > count || (packet[6].toInt() and 0x3f) != 0 || packet[7].toInt() != 0) continue
          if (u16(packet, header + 2) != 53) continue
          val query = packet.copyOfRange(header + 8, count)
          var offset = 12; val labels = ArrayList<String>(); var valid = true
          while (offset < query.size && query[offset].toInt() != 0) {
            val length = query[offset++].toInt() and 255
            if (length > 63 || offset + length > query.size) { valid = false; break }
            labels.add(String(query, offset, length, Charsets.US_ASCII)); offset += length
          }
          if (!valid || offset + 5 > query.size || labels.isEmpty()) continue
          val host = labels.joinToString(".").lowercase()
          val response = if (NorthRules.blocked(this, "website", host, host, 0, Int.MAX_VALUE)) {
            query.copyOf(offset + 5).also { it[2] = 0x81.toByte(); it[3] = 0x83.toByte(); for (i in 6..11) it[i] = 0 }
          } else try {
            DatagramSocket().use { socket ->
              protect(socket); socket.soTimeout = 3000
              socket.connect(upstream, 53); socket.send(DatagramPacket(query, query.size))
              val answer = ByteArray(4096); val datagram = DatagramPacket(answer, answer.size); socket.receive(datagram); answer.copyOf(datagram.length)
            }
          } catch (_: Exception) { continue }
          val reply = ByteArray(28 + response.size)
          reply[0] = 0x45; put16(reply, 2, reply.size); reply[8] = 64; reply[9] = 17
          System.arraycopy(packet, 16, reply, 12, 4); System.arraycopy(packet, 12, reply, 16, 4)
          put16(reply, 20, 53); put16(reply, 22, u16(packet, header)); put16(reply, 24, response.size + 8)
          System.arraycopy(response, 0, reply, 28, response.size)
          var checksum = 0; for (i in 0 until 20 step 2) checksum += u16(reply, i)
          while (checksum ushr 16 != 0) checksum = (checksum and 65535) + (checksum ushr 16)
          put16(reply, 10, checksum.inv() and 65535); output.write(reply)
        }
      } catch (_: Exception) { /* Closing or revoking the VPN ends the worker. */ }
      finally { running = false; stopSelf() }
    }.apply { name = "North DNS"; start() }
    return START_NOT_STICKY
  }
  private fun u16(bytes: ByteArray, at: Int) = ((bytes[at].toInt() and 255) shl 8) or (bytes[at + 1].toInt() and 255)
  private fun put16(bytes: ByteArray, at: Int, value: Int) { bytes[at] = (value ushr 8).toByte(); bytes[at + 1] = value.toByte() }
  override fun onRevoke() { stopSelf(); super.onRevoke() }
  override fun onDestroy() { running = false; network.shutdownNow(); try { tunnel?.close() } catch (_: Exception) {}; worker?.interrupt(); super.onDestroy() }
}
