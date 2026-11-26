import Foundation
import Capacitor
import Photos
import PhotosUI
import AVFoundation
import UIKit

/**
 * The camera roll for JF Effect's New post screen (src/lib/native-photos.ts).
 *
 * The app is a web view of jfeffect.com, and a web page can't see the photo
 * library; this plugin is what lets the New post screen show your photos the
 * way Instagram does:
 *
 *   status / requestAccess / manageLimited / openSettings   access to Photos
 *   albums                                                   Recents, Favorites, Videos, Selfies, Screenshots, your albums
 *   list                                                     a page of an album, newest first, each with a small JPEG thumbnail
 *   open                                                     the picked photo (an upright JPEG) or video (its original file) to a temp file
 *   read / close                                             that file in base64 chunks, then deleted
 *
 * Nothing leaves the phone here: the web page gets only what the person taps,
 * the same as Apple's own picker would hand it. Thumbnails never touch disk.
 * A file is read back through the bridge in chunks because the page is served
 * from https://jfeffect.com, where Capacitor's local-file URLs don't reach.
 */
@objc(JfPhotosPlugin)
public class JfPhotosPlugin: CAPPlugin, CAPBridgedPlugin, PHPhotoLibraryChangeObserver {
    public let identifier = "JfPhotosPlugin"
    public let jsName = "JfPhotos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageLimited", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "albums", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private struct OpenFile {
        let url: URL
        let size: Int
    }

    /// Guards `files` and `fetches` (calls arrive on the bridge's queue, work runs on `work`).
    private let state = DispatchQueue(label: "com.jfeffect.photos.state")
    private let work = DispatchQueue(label: "com.jfeffect.photos.work", qos: .userInitiated, attributes: .concurrent)
    private var files: [String: OpenFile] = [:]
    private var fetches: [String: PHFetchResult<PHAsset>] = [:]
    private var observing = false
    private let images = PHCachingImageManager()

    private lazy var tempDir: URL = {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("jf-photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    override public func load() {
        // anything left from a launch that ended mid-pick
        if let left = try? FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: nil) {
            for url in left { try? FileManager.default.removeItem(at: url) }
        }
        observeIfAllowed()
    }

    deinit {
        if observing { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
    }

    // MARK: access

    private func accessWord(_ s: PHAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "authorized"
        case .limited: return "limited"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "denied"
        }
    }

    private func allowed(_ s: PHAuthorizationStatus) -> Bool {
        return s == .authorized || s == .limited
    }

    /// Change events only once access is given (asking the library before that could prompt).
    private func observeIfAllowed() {
        guard !observing, allowed(PHPhotoLibrary.authorizationStatus(for: .readWrite)) else { return }
        observing = true
        PHPhotoLibrary.shared().register(self)
    }

    public func photoLibraryDidChange(_ changeInstance: PHChange) {
        state.async { self.fetches.removeAll() }
        notifyListeners("change", data: [:])
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["status": accessWord(PHPhotoLibrary.authorizationStatus(for: .readWrite))])
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { s in
            if self.allowed(s) {
                self.observeIfAllowed()
                self.state.async { self.fetches.removeAll() }
            }
            call.resolve(["status": self.accessWord(s)])
        }
    }

    /// "Manage": the system sheet that picks which photos JF Effect may see (limited access).
    @objc func manageLimited(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("No screen to show it on")
                return
            }
            PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: vc) { _ in
                self.state.async { self.fetches.removeAll() }
                call.resolve()
            }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    // MARK: albums and pages

    private func mediaOptions(_ kind: String?) -> PHFetchOptions {
        let opts = PHFetchOptions()
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        switch kind {
        case "image":
            opts.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        case "video":
            opts.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.video.rawValue)
        default:
            opts.predicate = NSPredicate(format: "mediaType == %d || mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        }
        return opts
    }

    /// One album's assets, newest first ("recents" = the whole library), kept until the library changes.
    private func assets(in album: String, kind: String?) -> PHFetchResult<PHAsset>? {
        let key = "\(album)|\(kind ?? "all")"
        if let cached = state.sync(execute: { fetches[key] }) { return cached }
        let result: PHFetchResult<PHAsset>
        if album == "recents" {
            result = PHAsset.fetchAssets(with: mediaOptions(kind))
        } else {
            guard let collection = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [album], options: nil).firstObject else { return nil }
            result = PHAsset.fetchAssets(in: collection, options: mediaOptions(kind))
        }
        state.sync { fetches[key] = result }
        return result
    }

    @objc func albums(_ call: CAPPluginCall) {
        guard allowed(PHPhotoLibrary.authorizationStatus(for: .readWrite)) else {
            call.resolve(["albums": []])
            return
        }
        work.async {
            var out: [[String: Any]] = []
            let all = PHAsset.fetchAssets(with: self.mediaOptions(nil))
            out.append(["id": "recents", "title": "Recents", "count": all.count])
            let smart: [PHAssetCollectionSubtype] = [.smartAlbumFavorites, .smartAlbumVideos, .smartAlbumSelfPortraits, .smartAlbumScreenshots]
            for subtype in smart {
                PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: subtype, options: nil).enumerateObjects { c, _, _ in
                    let n = PHAsset.fetchAssets(in: c, options: self.mediaOptions(nil)).count
                    if n > 0 { out.append(["id": c.localIdentifier, "title": c.localizedTitle ?? "Album", "count": n]) }
                }
            }
            PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: nil).enumerateObjects { c, _, _ in
                let n = PHAsset.fetchAssets(in: c, options: self.mediaOptions(nil)).count
                if n > 0 { out.append(["id": c.localIdentifier, "title": c.localizedTitle ?? "Album", "count": n]) }
            }
            call.resolve(["albums": out])
        }
    }

    private func kindWord(_ a: PHAsset) -> String {
        return a.mediaType == .video ? "video" : "image"
    }

    /// A page of an album: each asset's facts and a small JPEG to draw its tile.
    @objc func list(_ call: CAPPluginCall) {
        guard allowed(PHPhotoLibrary.authorizationStatus(for: .readWrite)) else {
            call.resolve(["total": 0, "assets": []])
            return
        }
        let album = call.getString("album") ?? "recents"
        let kind = call.getString("kind")
        let offset = max(0, call.getInt("offset") ?? 0)
        let limit = min(120, max(1, call.getInt("limit") ?? 48))
        let side = CGFloat(min(600, max(80, call.getInt("thumb") ?? 300)))
        work.async {
            guard let result = self.assets(in: album, kind: kind) else {
                call.resolve(["total": 0, "assets": []])
                return
            }
            let total = result.count
            let end = min(total, offset + limit)
            guard offset < end else {
                call.resolve(["total": total, "assets": []])
                return
            }
            let page = result.objects(at: IndexSet(integersIn: offset..<end))
            var thumbs = [String?](repeating: nil, count: page.count)
            let lock = NSLock()
            let opts = PHImageRequestOptions()
            opts.isSynchronous = true
            opts.deliveryMode = .highQualityFormat
            opts.resizeMode = .fast
            opts.isNetworkAccessAllowed = false
            let target = CGSize(width: side, height: side * 4 / 3)
            DispatchQueue.concurrentPerform(iterations: page.count) { i in
                var encoded: String?
                self.images.requestImage(for: page[i], targetSize: target, contentMode: .aspectFill, options: opts) { img, _ in
                    if let data = img?.jpegData(compressionQuality: 0.72) {
                        encoded = "data:image/jpeg;base64," + data.base64EncodedString()
                    }
                }
                lock.lock()
                thumbs[i] = encoded
                lock.unlock()
            }
            var out: [[String: Any]] = []
            for (i, a) in page.enumerated() {
                var row: [String: Any] = [
                    "id": a.localIdentifier,
                    "kind": self.kindWord(a),
                    "width": a.pixelWidth,
                    "height": a.pixelHeight,
                    "duration": a.mediaType == .video ? a.duration : 0,
                    "created": (a.creationDate?.timeIntervalSince1970 ?? 0) * 1000
                ]
                if let t = thumbs[i] { row["thumb"] = t }
                out.append(row)
            }
            call.resolve(["total": total, "assets": out])
        }
    }

    // MARK: opening a pick

    private func originalName(_ a: PHAsset, ext: String) -> String {
        let name = PHAssetResource.assetResources(for: a).first?.originalFilename ?? "photo"
        let base = (name as NSString).deletingPathExtension
        return "\(base.isEmpty ? "photo" : base).\(ext)"
    }

    private func remember(_ url: URL) -> (String, Int) {
        let token = url.deletingPathExtension().lastPathComponent
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        state.sync { files[token] = OpenFile(url: url, size: size) }
        return (token, size)
    }

    /// The picked photo (an upright JPEG, its long side at most `maxSide`) or video (its own file) in a temp file.
    @objc func open(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            call.reject("That photo isn't in your library any more", "GONE")
            return
        }
        let maxBytes = call.getInt("maxBytes") ?? 0
        if asset.mediaType == .video {
            openVideo(call, asset: asset, id: id, maxBytes: maxBytes)
        } else {
            openPhoto(call, asset: asset, id: id, maxSide: CGFloat(min(6000, max(640, call.getInt("maxSide") ?? 3072))))
        }
    }

    private func progress(_ id: String, _ p: Double) {
        notifyListeners("progress", data: ["id": id, "progress": max(0, min(1, p))])
    }

    private func openPhoto(_ call: CAPPluginCall, asset: PHAsset, id: String, maxSide: CGFloat) {
        work.async {
            let w = CGFloat(asset.pixelWidth), h = CGFloat(asset.pixelHeight)
            let scale = min(1, maxSide / max(1, max(w, h)))
            let target = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
            let opts = PHImageRequestOptions()
            opts.isSynchronous = true
            opts.deliveryMode = .highQualityFormat
            opts.resizeMode = .exact
            opts.version = .current
            opts.isNetworkAccessAllowed = true
            opts.progressHandler = { p, _, _, _ in self.progress(id, p) }
            var picked: UIImage?
            self.images.requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: opts) { img, _ in
                picked = img
            }
            guard let img = picked else {
                call.reject("Couldn't open that photo (it may still be downloading from iCloud)", "OPEN_FAILED")
                return
            }
            // drawn upright: the page never has to read its orientation
            let size = CGSize(width: (img.size.width * img.scale).rounded(), height: (img.size.height * img.scale).rounded())
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let upright = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
                UIColor.white.setFill()
                ctx.fill(CGRect(origin: .zero, size: size))
                img.draw(in: CGRect(origin: .zero, size: size))
            }
            guard let data = upright.jpegData(compressionQuality: 0.9) else {
                call.reject("Couldn't open that photo", "OPEN_FAILED")
                return
            }
            let url = self.tempDir.appendingPathComponent(UUID().uuidString).appendingPathExtension("jpg")
            do {
                try data.write(to: url, options: .atomic)
            } catch {
                call.reject("Couldn't open that photo", "OPEN_FAILED")
                return
            }
            let (token, bytes) = self.remember(url)
            call.resolve([
                "token": token,
                "name": self.originalName(asset, ext: "jpg"),
                "mime": "image/jpeg",
                "size": bytes,
                "width": Int(size.width),
                "height": Int(size.height),
                "duration": 0
            ])
        }
    }

    /// A video already on the phone: its file's size, read before anything is copied (nil: not known yet, e.g. in iCloud).
    private func localVideoSize(_ asset: PHAsset, done: @escaping (Int?) -> Void) {
        let opts = PHVideoRequestOptions()
        opts.isNetworkAccessAllowed = false
        opts.version = .current
        opts.deliveryMode = .highQualityFormat
        PHImageManager.default().requestAVAsset(forVideo: asset, options: opts) { av, _, _ in
            guard let url = (av as? AVURLAsset)?.url, let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize else {
                done(nil)
                return
            }
            done(size)
        }
    }

    private func openVideo(_ call: CAPPluginCall, asset: PHAsset, id: String, maxBytes: Int) {
        let resources = PHAssetResource.assetResources(for: asset)
        // an edit made in Photos (a trim, a filter) is the full-size video; else the original
        guard let resource = resources.first(where: { $0.type == .fullSizeVideo }) ?? resources.first(where: { $0.type == .video }) else {
            call.reject("Couldn't open that video", "OPEN_FAILED")
            return
        }
        localVideoSize(asset) { known in
            if maxBytes > 0, let known = known, known > maxBytes {
                call.resolve(["tooBig": true, "size": known])
                return
            }
            var ext = (resource.originalFilename as NSString).pathExtension.lowercased()
            if ext.isEmpty { ext = "mov" }
            let url = self.tempDir.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
            let opts = PHAssetResourceRequestOptions()
            opts.isNetworkAccessAllowed = true
            opts.progressHandler = { p in self.progress(id, p) }
            PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: opts) { error in
                if error != nil {
                    try? FileManager.default.removeItem(at: url)
                    call.reject("Couldn't open that video (it may still be downloading from iCloud)", "OPEN_FAILED")
                    return
                }
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if maxBytes > 0, size > maxBytes {
                    try? FileManager.default.removeItem(at: url)
                    call.resolve(["tooBig": true, "size": size])
                    return
                }
                let (token, bytes) = self.remember(url)
                call.resolve([
                    "token": token,
                    "name": resource.originalFilename.isEmpty ? "video.\(ext)" : resource.originalFilename,
                    "mime": ext == "mp4" || ext == "m4v" ? "video/mp4" : "video/quicktime",
                    "size": bytes,
                    "width": asset.pixelWidth,
                    "height": asset.pixelHeight,
                    "duration": asset.duration
                ])
            }
        }
    }

    // MARK: reading it back

    @objc func read(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), let file = state.sync(execute: { files[token] }) else {
            call.reject("That file is closed", "CLOSED")
            return
        }
        let offset = max(0, call.getInt("offset") ?? 0)
        let length = min(8 * 1024 * 1024, max(1, call.getInt("length") ?? 3 * 1024 * 1024))
        work.async {
            do {
                let handle = try FileHandle(forReadingFrom: file.url)
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(offset))
                let data = try handle.read(upToCount: length) ?? Data()
                call.resolve(["data": data.base64EncodedString(), "eof": offset + data.count >= file.size])
            } catch {
                call.reject("Couldn't read that file", "READ_FAILED")
            }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        if let token = call.getString("token"), let file = state.sync(execute: { files.removeValue(forKey: token) }) {
            try? FileManager.default.removeItem(at: file.url)
        }
        call.resolve()
    }
}
