// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "RaycastOCR",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .library(
            name: "RaycastOCR",
            targets: ["RaycastOCR"]),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "RaycastOCR",
            dependencies: []),
    ]
)
