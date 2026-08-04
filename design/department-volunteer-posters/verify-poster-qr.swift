import CoreImage
import Foundation

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: swift verify-poster-qr.swift <expected-url> <poster.png> [...]\n", stderr)
    exit(2)
}

let expectedURL = CommandLine.arguments[1]
let posterPaths = Array(CommandLine.arguments.dropFirst(2))
let context = CIContext(options: [.useSoftwareRenderer: false])

guard let detector = CIDetector(
    ofType: CIDetectorTypeQRCode,
    context: context,
    options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
) else {
    fputs("Could not initialize QR detector.\n", stderr)
    exit(3)
}

for posterPath in posterPaths {
    let posterURL = URL(fileURLWithPath: posterPath)
    guard let image = CIImage(contentsOf: posterURL) else {
        fputs("Could not read \(posterPath)\n", stderr)
        exit(4)
    }

    let decoded = detector.features(in: image)
        .compactMap { ($0 as? CIQRCodeFeature)?.messageString }

    guard decoded.contains(expectedURL) else {
        fputs("QR verification failed for \(posterPath)\n", stderr)
        exit(5)
    }

    print("Verified \(posterURL.lastPathComponent): \(expectedURL)")
}
