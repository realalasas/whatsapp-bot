
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode')
const qrcodeTerminal = require('qrcode-terminal')
const fs = require('fs')
const path = require('path')

// auth folder name
const AUTH_FOLDER = './auth_info_baileys'

async function startBot() {
  // prepare auth state and version
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Baileys', 'NodeJS']
  })

  // save creds when updated
  sock.ev.on('creds.update', saveCreds)

  // connection updates (QR / open / close)
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      try {
        console.log('\n📱 رمز QR جديد. سيُحفظ في qr.png (افتح الصورة وامسحها بجهاز WhatsApp).')
        // save image file
        await qrcode.toFile(path.join(__dirname, 'qr.png'), qr)
        // also print small one in terminal for convenience
        qrcodeTerminal.generate(qr, { small: true })
        console.log('✔️ تم حفظ qr.png') 
      } catch (e) {
        console.error('✖️ فشل توليد QR:', e.message || e)
      }
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut)
      console.log('🔌 الاتصال قطع. إعادة الاتصال؟', shouldReconnect)
      if (shouldReconnect) startBot()
    } else if (connection === 'open') {
      console.log('✅ تم الاتصال بواتساب بنجاح.')
    }
  })

  // messages handler
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return
      const msg = m.messages[0]
      if (!msg || msg.key?.fromMe) return

      const from = msg.key.remoteJid
      const isGroup = from && from.endsWith('@g.us')
      // get text content
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''

      // look for tracking codes (e.g., MSKU1234567 or AWB123456789)
      const trackingRegex = /([A-Z]{2,5}\d{6,12})/i
      const match = text.match(trackingRegex)
      if (!match) return

      const code = match[1].toUpperCase()

      // read shipments.json
      let shipments = []
      try {
        shipments = JSON.parse(fs.readFileSync(path.join(__dirname, 'shipments.json'), 'utf-8'))
      } catch (e) {
        console.error('خطأ قراءة shipments.json', e.message || e)
      }

      const shipment = shipments.find(s => (s.tracking_code && s.tracking_code.toUpperCase() === code) || (s.trackingNumber && s.trackingNumber === code))

      let reply = ''
      if (shipment) {
        reply = `📦 شحنة: ${shipment.tracking_code || shipment.trackingNumber}\n` +
                `- النوع: ${shipment.type || shipment.method || 'N/A'}\n` +
                `- الحالة: ${shipment.status || 'N/A'}\n` +
                `- المغادرة: ${shipment.departure_date || 'N/A'}\n` +
                `- ميناء/مطار الوصول: ${shipment.arrival_port || shipment.destination_port || 'N/A'}\n` +
                `- الوصول المتوقع: ${shipment.expected_arrival || 'N/A'}`
      } else {
        reply = `❌ لم يتم العثور على شحنة بالرمز: ${code}`
      }

      // send reply to the same chat (group or direct)
      await sock.sendMessage(from, { text: reply })
    } catch (err) {
      console.error('خطأ في معالج الرسائل:', err)
    }
  })
}

startBot().catch(err => console.error('خطأ بدء البوت:', err))
