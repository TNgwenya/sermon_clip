import AppKit
import CoreImage
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: swift generate-qr.swift <url> <output.png>\n", stderr)
    exit(2)
}

let message = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]

guard let messageData = message.data(using: .utf8),
      let qrFilter = CIFilter(name: "CIQRCodeGenerator") else {
    fputs("Could not initialize QR generator.\n", stderr)
    exit(3)
}

qrFilter.setValue(messageData, forKey: "inputMessage")
qrFilter.setValue("H", forKey: "inputCorrectionLevel")

guard let qrImage = qrFilter.outputImage else {
    fputs("Could not create QR image.\n", stderr)
    exit(4)
}

let ciContext = CIContext(options: [.useSoftwareRenderer: false])
guard let sourceImage = ciContext.createCGImage(qrImage, from: qrImage.extent) else {
    fputs("Could not render QR image.\n", stderr)
    exit(5)
}

let moduleCount = Int(qrImage.extent.width)
let scale = 16
let quietModules = 4
let quietPixels = quietModules * scale
let outputSize = (moduleCount + quietModules * 2) * scale

guard let bitmap = CGContext(
    data: nil,
    width: outputSize,
    height: outputSize,
    bitsPerComponent: 8,
    bytesPerRow: outputSize * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fputs("Could not create QR bitmap.\n", stderr)
    exit(6)
}

bitmap.setFillColor(NSColor.white.cgColor)
bitmap.fill(CGRect(x: 0, y: 0, width: outputSize, height: outputSize))
bitmap.interpolationQuality = .none
bitmap.draw(
    sourceImage,
    in: CGRect(
        x: quietPixels,
        y: quietPixels,
        width: moduleCount * scale,
        height: moduleCount * scale
    )
)

guard let finalImage = bitmap.makeImage(),
      let pngData = NSBitmapImageRep(cgImage: finalImage).representation(
        using: .png,
        properties: [:]
      ) else {
    fputs("Could not encode QR PNG.\n", stderr)
    exit(7)
}

let outputURL = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try pngData.write(to: outputURL)

guard let verificationImage = CIImage(contentsOf: outputURL),
      let detector = CIDetector(
        ofType: CIDetectorTypeQRCode,
        context: ciContext,
        options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
      ),
      let feature = detector.features(in: verificationImage)
        .compactMap({ $0 as? CIQRCodeFeature })
        .first,
      feature.messageString == message else {
    fputs("QR verification failed.\n", stderr)
    exit(8)
}

print("Verified QR destination: \(feature.messageString ?? "")")
