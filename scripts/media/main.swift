import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

// Renders the film that scripts/media/cut.ts plans. The plan is a list of frames, each a list of layers drawn in order:
// a part of an image into a rectangle (the camera), a dimmed frame with a hole in it (a spotlight), a ring (a click), or a
// colour over everything (the fade at the end).
// Frames are encoded as H.264 and the sound track is laid under them; macOS frameworks only.
//   swiftc -O main.swift -o compose && ./compose <edl.json> <sound.m4a> <out.mp4>

struct Layer: Decodable {
  let img: String?
  let crop: [Double]?
  let dest: [Double]?
  let alpha: Double?
  let radius: Double?
  let shadow: Double?
  let dim: [Double]?
  let ring: [Double]?
  let fill: [Double]?
}
struct Plan: Decodable {
  let fps: Int32
  let size: [Int]
  let bitrate: Int
  let background: [Double]
  let frames: [[Layer]]
}

let args = CommandLine.arguments
guard args.count == 4 else {
  FileHandle.standardError.write(Data("usage: compose <edl.json> <sound.m4a> <out.mp4>\n".utf8))
  exit(2)
}
let plan = try JSONDecoder().decode(Plan.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let sound = URL(fileURLWithPath: args[2])
let output = URL(fileURLWithPath: args[3])
let width = plan.size[0], height = plan.size[1]
let H = Double(height)
let silent = FileManager.default.temporaryDirectory.appendingPathComponent("film-\(UUID().uuidString).mp4")
try? FileManager.default.removeItem(at: output)

// Decoded images, kept while they are in use: most frames show the same still as the one before.
var cache: [String: CGImage] = [:]
var recent: [String] = []
func image(_ path: String) -> CGImage {
  if let hit = cache[path] { return hit }
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
    let decoded = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
  else { fatalError("cannot read \(path)") }
  cache[path] = decoded
  recent.append(path)
  if recent.count > 48 { cache[recent.removeFirst()] = nil }
  return decoded
}

// The plan's rectangles are [x, y, w, h] from the top left; Core Graphics counts from the bottom left.
func rect(_ r: [Double]) -> CGRect { CGRect(x: r[0], y: H - r[1] - r[3], width: r[2], height: r[3]) }

func draw(_ layer: Layer, in context: CGContext) {
  context.saveGState()
  defer { context.restoreGState() }
  context.setAlpha(CGFloat(layer.alpha ?? 1))
  if let colour = layer.fill {
    context.setFillColor(CGColor(red: colour[0], green: colour[1], blue: colour[2], alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    return
  }
  if let hole = layer.dim {
    let path = CGMutablePath()
    path.addRect(CGRect(x: 0, y: 0, width: width, height: height))
    let r = CGFloat(layer.radius ?? 0)
    path.addPath(CGPath(roundedRect: rect(hole), cornerWidth: r, cornerHeight: r, transform: nil))
    context.addPath(path)
    context.setFillColor(CGColor(red: 0.03, green: 0.05, blue: 0.10, alpha: 0.62))
    context.fillPath(using: .evenOdd)
    return
  }
  if let ring = layer.ring {
    let circle = CGRect(x: ring[0] - ring[2], y: H - ring[1] - ring[2], width: ring[2] * 2, height: ring[2] * 2)
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.28))
    context.fillEllipse(in: circle)
    context.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.9))
    context.setLineWidth(3)
    context.strokeEllipse(in: circle.insetBy(dx: 1.5, dy: 1.5))
    return
  }
  guard let path = layer.img, let destRect = layer.dest else { return }
  let picture = image(path)
  let crop = layer.crop ?? [0, 0, Double(picture.width), Double(picture.height)]
  let target = rect(destRect)
  let radius = CGFloat(layer.radius ?? 0)
  if let blur = layer.shadow, blur > 0 {
    context.setShadow(
      offset: CGSize(width: 0, height: -blur * 0.35), blur: CGFloat(blur),
      color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.5))
    context.addPath(CGPath(roundedRect: target, cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fillPath()
    context.setShadow(offset: .zero, blur: 0, color: nil)
  }
  context.addPath(CGPath(roundedRect: target, cornerWidth: radius, cornerHeight: radius, transform: nil))
  context.clip()
  // Only the pixels around the crop are drawn, at their exact position, so a slow camera move does not step.
  let scale = destRect[2] / crop[2]
  let x0 = max(0, floor(crop[0]) - 2), y0 = max(0, floor(crop[1]) - 2)
  let x1 = min(Double(picture.width), ceil(crop[0] + crop[2]) + 2)
  let y1 = min(Double(picture.height), ceil(crop[1] + crop[3]) + 2)
  guard let part = picture.cropping(to: CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)) else { return }
  let left = destRect[0] + (x0 - crop[0]) * scale
  let top = destRect[1] + (y0 - crop[1]) * scale
  context.interpolationQuality = .high
  context.draw(part, in: rect([left, top, (x1 - x0) * scale, (y1 - y0) * scale]))
}

let writer = try AVAssetWriter(outputURL: silent, fileType: .mp4)
let input = AVAssetWriterInput(
  mediaType: .video,
  outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
      AVVideoAverageBitRateKey: plan.bitrate,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
      AVVideoMaxKeyFrameIntervalKey: Int(plan.fps) * 4,
      AVVideoExpectedSourceFrameRateKey: Int(plan.fps),
    ],
  ])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func render(_ layers: [Layer]) -> CVPixelBuffer? {
  guard let pool = adaptor.pixelBufferPool else { return nil }
  var out: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out)
  guard let pixels = out else { return nil }
  CVPixelBufferLockBaseAddress(pixels, [])
  defer { CVPixelBufferUnlockBaseAddress(pixels, []) }
  guard
    let context = CGContext(
      data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
  else { return nil }
  let bg = plan.background
  context.setFillColor(CGColor(red: bg[0], green: bg[1], blue: bg[2], alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  for layer in layers { draw(layer, in: context) }
  return pixels
}

let queue = DispatchQueue(label: "frames")
let done = DispatchSemaphore(value: 0)
var index = 0
input.requestMediaDataWhenReady(on: queue) {
  while input.isReadyForMoreMediaData {
    if index >= plan.frames.count {
      input.markAsFinished()
      writer.finishWriting { done.signal() }
      return
    }
    autoreleasepool {
      if let pixels = render(plan.frames[index]) {
        adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(index), timescale: plan.fps))
      }
      index += 1
      if index % 300 == 0 { print("\(index) of \(plan.frames.count) frames") }
    }
  }
}
done.wait()
if writer.status != .completed { fatalError("video failed: \(String(describing: writer.error))") }

// The sound track (already mixed) under the picture, copied as it is.
func load<T>(_ work: @escaping () async throws -> T) -> T {
  var result: T?
  let wait = DispatchSemaphore(value: 0)
  Task {
    result = try await work()
    wait.signal()
  }
  wait.wait()
  return result!
}
let composition = AVMutableComposition()
let picture = AVURLAsset(url: silent)
let audio = AVURLAsset(url: sound)
let pictureTrack = load { try await picture.loadTracks(withMediaType: .video).first! }
let pictureLength = load { try await picture.load(.duration) }
let audioTrack = load { try await audio.loadTracks(withMediaType: .audio).first! }
let audioLength = load { try await audio.load(.duration) }
let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
try video.insertTimeRange(CMTimeRange(start: .zero, duration: pictureLength), of: pictureTrack, at: .zero)
let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
try track.insertTimeRange(
  CMTimeRange(start: .zero, duration: CMTimeMinimum(audioLength, pictureLength)), of: audioTrack, at: .zero)
guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
  fatalError("no exporter")
}
load { try await export.export(to: output, as: .mp4) }
try? FileManager.default.removeItem(at: silent)
print("wrote \(output.path): \(plan.frames.count) frames at \(plan.fps) fps")
