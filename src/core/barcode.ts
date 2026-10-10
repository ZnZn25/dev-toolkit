import JsBarcode from 'jsbarcode'
import QRCode, { type QRCodeErrorCorrectionLevel } from 'qrcode'

export type BarcodeFormat = 'QR' | 'CODE128' | 'CODE39' | 'EAN13' | 'EAN8' | 'UPC' | 'ITF14'
export type QrErrorCorrection = Extract<QRCodeErrorCorrectionLevel, 'L' | 'M' | 'Q' | 'H'>

const maxLinearBarcodeLength = 4096

export async function generateBarcodeSvg(value: string, format: BarcodeFormat, errorCorrection: QrErrorCorrection): Promise<string> {
  if (!value) throw new Error('请输入要编码的内容')

  if (format === 'QR') {
    return QRCode.toString(value, {
      type: 'svg',
      errorCorrectionLevel: errorCorrection,
      margin: 4,
      width: 320,
      color: { dark: '#111827ff', light: '#ffffffff' },
    })
  }

  if (value.length > maxLinearBarcodeLength) throw new Error(`一维条码内容不能超过 ${maxLinearBarcodeLength.toLocaleString()} 个字符`)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, value, {
    format,
    width: 2,
    height: 100,
    margin: 16,
    displayValue: true,
    fontSize: 16,
    lineColor: '#111827',
    background: '#ffffff',
  })
  return new XMLSerializer().serializeToString(svg)
}
