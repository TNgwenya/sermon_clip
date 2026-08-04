import AppKit
import CoreImage
import Foundation
import ImageIO
import Vision

let rsvpURL = "https://melusi.app/connect/believe-belong-become/events/dfrzcpInFr-bdfW4wReH-dL0pBMefA4n/rsvp"

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func generateQR(outputPath: String) {
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
        fail("Could not create the QR generator.")
    }
    filter.setValue(Data(rsvpURL.utf8), forKey: "inputMessage")
    filter.setValue("H", forKey: "inputCorrectionLevel")
    guard let qrImage = filter.outputImage else {
        fail("The QR generator returned no image.")
    }

    let sourceScale: CGFloat = 12
    let scaled = qrImage.transformed(
        by: CGAffineTransform(scaleX: sourceScale, y: sourceScale)
    )
    let representation = NSCIImageRep(ciImage: scaled)
    let image = NSImage(size: representation.size)
    image.addRepresentation(representation)
    guard
        let tiffData = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiffData)
    else {
        fail("Could not rasterise the QR code.")
    }
    guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
        fail("Could not encode the QR code as PNG.")
    }

    let outputURL = URL(fileURLWithPath: outputPath)
    try? FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    do {
        try pngData.write(to: outputURL)
    } catch {
        fail("Could not write QR code: \(error)")
    }

    print("Generated QR matrix: \(Int(qrImage.extent.width)) modules")
    print(outputPath)
}

func verifyQR(imagePath: String) {
    let imageURL = URL(fileURLWithPath: imagePath)
    guard
        let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
        let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        fail("Could not open the image for QR verification.")
    }

    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    request.usesCPUOnly = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fail("QR verification failed: \(error)")
    }

    let payloads = (request.results ?? []).compactMap(\.payloadStringValue)
    guard payloads.contains(rsvpURL) else {
        fail("The expected RSVP link was not decoded. Found: \(payloads)", code: 2)
    }
    print("Verified QR payload:")
    print(rsvpURL)
}

guard CommandLine.arguments.count >= 3 else {
    fail("Usage: conference-rsvp-qr.swift generate|verify <path>")
}

switch CommandLine.arguments[1] {
case "generate":
    generateQR(outputPath: CommandLine.arguments[2])
case "verify":
    verifyQR(imagePath: CommandLine.arguments[2])
default:
    fail("Unknown mode: \(CommandLine.arguments[1])")
}
