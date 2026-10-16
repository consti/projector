// audiotap: the sound of one process, as it plays, on stdout.
//
//   audiotap <pid>
//
// Taps the audio of the process with that pid (Core Audio process taps, macOS
// 14.2+), mixes it down to mono float32 and writes it to stdout: a 16-byte
// header ("PTAP", sample rate, channels = 1, reserved), then raw samples until
// stdin closes. Projector runs it against the Music app so the visuals and the
// effects can hear what Apple Music is playing without the sound passing
// through the app. The first run asks for System Audio Recording permission.

import Foundation
import CoreAudio
import AudioToolbox

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

guard CommandLine.arguments.count > 1, let pid = pid_t(CommandLine.arguments[1]) else { fail("usage: audiotap <pid>") }

func prop(_ sel: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

// the process, as Core Audio knows it
var addr = prop(kAudioHardwarePropertyTranslatePIDToProcessObject)
var pidIn = pid
var procObj = AudioObjectID(kAudioObjectUnknown)
var size = UInt32(MemoryLayout<AudioObjectID>.size)
var err = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, UInt32(MemoryLayout<pid_t>.size), &pidIn, &size, &procObj)
if err != noErr || procObj == kAudioObjectUnknown { fail("no audio process for pid \(pid) (\(err))") }

// the tap
let desc = CATapDescription(stereoMixdownOfProcesses: [procObj])
desc.uuid = UUID()
desc.name = "Projector tap"
desc.muteBehavior = CATapMuteBehavior.unmuted
desc.isPrivate = true
var tapID = AudioObjectID(kAudioObjectUnknown)
err = AudioHardwareCreateProcessTap(desc, &tapID)
if err != noErr { fail("could not tap the process (\(err)); is System Audio Recording allowed for Projector in System Settings > Privacy & Security?") }

var fmt = AudioStreamBasicDescription()
size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
addr = prop(kAudioTapPropertyFormat)
err = AudioObjectGetPropertyData(tapID, &addr, 0, nil, &size, &fmt)
if err != noErr { fail("tap format (\(err))") }

// an aggregate device of the default output plus the tap; the tap arrives as its input
var outDev = AudioObjectID(kAudioObjectUnknown)
size = UInt32(MemoryLayout<AudioObjectID>.size)
addr = prop(kAudioHardwarePropertyDefaultOutputDevice)
AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &outDev)
var uidRef: Unmanaged<CFString>? = nil
size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
addr = prop(kAudioDevicePropertyDeviceUID)
AudioObjectGetPropertyData(outDev, &addr, 0, nil, &size, &uidRef)
let outUID = (uidRef?.takeUnretainedValue() as String?) ?? ""

let aggDesc: [String: Any] = [
  kAudioAggregateDeviceNameKey: "Projector tap",
  kAudioAggregateDeviceUIDKey: "com.oozou.projector.tap." + UUID().uuidString,
  kAudioAggregateDeviceMainSubDeviceKey: outUID,
  kAudioAggregateDeviceIsPrivateKey: true,
  kAudioAggregateDeviceIsStackedKey: false,
  kAudioAggregateDeviceTapAutoStartKey: true,
  kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
  kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: desc.uuid.uuidString]],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
err = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
if err != noErr { fail("aggregate device (\(err))") }

let out = FileHandle.standardOutput
var header = Data("PTAP".utf8)
var rate = UInt32(fmt.mSampleRate); header.append(Data(bytes: &rate, count: 4))
var one = UInt32(1); header.append(Data(bytes: &one, count: 4))
var zero = UInt32(0); header.append(Data(bytes: &zero, count: 4))
out.write(header)

// the realtime thread hands its mixdown to a queue; a slow reader must never stall it
let writer = DispatchQueue(label: "audiotap.write")
let interleaved = (fmt.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
let verbose = CommandLine.arguments.contains("-v")
if verbose { FileHandle.standardError.write("tap \(tapID) rate \(fmt.mSampleRate) ch \(fmt.mChannelsPerFrame) interleaved \(interleaved) out \(outUID) agg \(aggID)\n".data(using: .utf8)!) }
var calls = 0
var procID: AudioDeviceIOProcID? = nil
err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inData, _, _, _ in
  let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
  calls += 1
  if verbose && calls == 1 { FileHandle.standardError.write("first io callback: \(abl.count) buffers, \(abl.count > 0 ? abl[0].mDataByteSize : 0) bytes\n".data(using: .utf8)!) }
  guard abl.count > 0 else { return }
  var mono: [Float]
  if interleaved {
    let buf = abl[0]
    guard let p = buf.mData?.assumingMemoryBound(to: Float.self) else { return }
    let nch = max(1, Int(buf.mNumberChannels))
    let frames = Int(buf.mDataByteSize) / 4 / nch
    mono = [Float](repeating: 0, count: frames)
    for i in 0..<frames { var s: Float = 0; for c in 0..<nch { s += p[i * nch + c] }; mono[i] = s / Float(nch) }
  } else {
    let frames = Int(abl[0].mDataByteSize) / 4
    mono = [Float](repeating: 0, count: frames)
    for b in abl {
      guard let p = b.mData?.assumingMemoryBound(to: Float.self) else { continue }
      for i in 0..<frames { mono[i] += p[i] }
    }
    let n = Float(abl.count)
    for i in 0..<frames { mono[i] /= n }
  }
  let data = mono.withUnsafeBufferPointer { Data(buffer: $0) }
  writer.async { out.write(data) }
}
if err != noErr { fail("io proc (\(err))") }
err = AudioDeviceStart(aggID, procID)
if err != noErr { fail("start (\(err))") }

// gone when the parent is: stdin closes
DispatchQueue.global().async {
  _ = FileHandle.standardInput.readDataToEndOfFile()
  AudioDeviceStop(aggID, procID)
  if let p = procID { AudioDeviceDestroyIOProcID(aggID, p) }
  AudioHardwareDestroyAggregateDevice(aggID)
  AudioHardwareDestroyProcessTap(tapID)
  exit(0)
}
RunLoop.main.run()
