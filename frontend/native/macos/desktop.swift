import Cocoa
import WebKit

// A small native shell; no remote web content receives a native command bridge.
final class DesktopApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var setup: NSStackView!
    var status: NSTextField!
    var busy = false
    var origin: URL?
    var loginProcess: Process?
    let resources = Bundle.main.resourceURL!
    let profile = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".repo-network")
    var buttons = [NSButton]()

    func applicationDidFinishLaunching(_ note: Notification) {
        let menu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle:"Setup & connection",action:#selector(showSetup),keyEquivalent:",").target = self
        appMenu.addItem(withTitle:"Quit AIConnect",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let edit = NSMenuItem(); edit.title = "Edit"; let edits = NSMenu(title:"Edit")
        for (title,selector,key) in [("Copy","copy:","c"),("Paste","paste:","v"),("Cut","cut:","x"),("Select All","selectAll:","a")] { edits.addItem(withTitle:title,action:Selector(selector),keyEquivalent:key) }
        edit.submenu = edits; menu.addItem(edit); NSApp.mainMenu = menu
        window = NSWindow(contentRect:NSRect(x:0,y:0,width:1120,height:800),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.title = "AIConnect"; window.minSize = NSSize(width:760,height:600); window.center()
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        web = WKWebView(frame:.zero,configuration:config); web.navigationDelegate = self; web.uiDelegate = self
        setup = NSStackView(); setup.orientation = .vertical; setup.alignment = .leading; setup.spacing = 16
        let title = NSTextField(labelWithString:"AIConnect"); title.font = .systemFont(ofSize:34,weight:.bold); setup.addArrangedSubview(title)
        let intro = NSTextField(wrappingLabelWithString:"Your team. Your code. Connected agents.\nNode and Codex are included. Your account, repositories and private keys stay on this Mac."); intro.font = .systemFont(ofSize:15); setup.addArrangedSubview(intro)
        status = NSTextField(wrappingLabelWithString:"Start with Check this Mac. Then sign in, open Settings to join your team, and share a repository using the folder picker."); setup.addArrangedSubview(status)
        add("1. Check this Mac",#selector(check))
        add("Install Apple Git tools (only if missing)",#selector(installGit))
        add("2. Sign in to Codex in your browser",#selector(login))
        add("3. Open dashboard / join a network",#selector(dashboard))
        add("Network & setup settings",#selector(settings))
        add("Connect / repair Codex desktop integration",#selector(integration))
        add("Open notification menu",#selector(notifications))
        add("Start at login…",#selector(loginItems))
        add("Stop companion…",#selector(stop))
        let foot = NSTextField(wrappingLabelWithString:"Closing this window leaves the companion running so requests can arrive. Quit does not stop workers. Use Stop companion when finished. Model usage is billed or limited by your own Codex account. No repositories are shared until you choose them."); foot.font = .systemFont(ofSize:12); foot.textColor = .secondaryLabelColor; setup.addArrangedSubview(foot)
        showSetup(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
        let parent = Bundle.main.bundleURL.deletingLastPathComponent().path
        let userApps = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path
        if parent != "/Applications" && parent != userApps {
            status.stringValue = "Before setup: quit and drag AIConnect.app into Applications (or your home Applications folder). Do not run it from the disk image or Downloads: Codex needs a stable installed path."
            buttons.forEach{$0.isEnabled = false}; return
        }
        try? FileManager.default.createDirectory(at:profile,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        if UserDefaults.standard.bool(forKey:"openedDashboard") {openDashboard("start")} else {check()}
    }
    func add(_ title:String,_ action:Selector){let b=NSButton(title:title,target:self,action:action);b.bezelStyle = .rounded;setup.addArrangedSubview(b);buttons.append(b)}
    @objc func showSetup(){
        let container=NSView();window.contentView=container;setup.translatesAutoresizingMaskIntoConstraints=false;container.addSubview(setup)
        NSLayoutConstraint.activate([setup.topAnchor.constraint(equalTo:container.topAnchor,constant:30),setup.leadingAnchor.constraint(equalTo:container.leadingAnchor,constant:36),setup.trailingAnchor.constraint(equalTo:container.trailingAnchor,constant:-36)])
    }
    func env()->[String:String]{
        var e=ProcessInfo.processInfo.environment
        e["RN_HOME"]=profile.path;e["RN_SERVER"]="https://aiconnect.162-35-104-181.sslip.io";e["RN_PORT"]="4319"
        e["RN_CODEX_BIN"]=resources.appendingPathComponent("runtime/bin/codex").path
        #if arch(arm64)
        let triple="aarch64-apple-darwin"
        #else
        let triple="x86_64-apple-darwin"
        #endif
        e["PATH"]=resources.appendingPathComponent("runtime/bin").path+":"+resources.appendingPathComponent("runtime/vendor/"+triple+"/codex-path").path+":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return e
    }
    func bridge(_ action:String,_ done:@escaping([String:Any])->Void){
        if busy{return};busy=true;buttons.forEach{$0.isEnabled=false};status.stringValue = action == "login" ? "Complete Codex sign-in in your browser. This may take a few minutes. AIConnect never asks for your password." : "Working…"
        let p=Process();p.executableURL=resources.appendingPathComponent("runtime/bin/node");p.arguments=[resources.appendingPathComponent("app/frontend/src/desktop.ts").path,action];p.environment=env();p.currentDirectoryURL=profile
        if action == "login" {loginProcess=p}
        DispatchQueue.global(qos:.userInitiated).async {
            // Drain stdout and stderr together to avoid pipe deadlocks. Never persist login output.
            let pipe=Pipe();p.standardOutput=pipe;p.standardError=pipe
            do {
                try p.run();let data=pipe.fileHandleForReading.readDataToEndOfFile();p.waitUntilExit()
                let text=String(data:data,encoding:.utf8) ?? ""
                let last=text.split(separator:"\n").last.map(String.init) ?? ""
                let result=(try? JSONSerialization.jsonObject(with:Data(last.utf8))) as? [String:Any]
                DispatchQueue.main.async {self.busy=false;self.loginProcess=nil;self.buttons.forEach{$0.isEnabled=true};if p.terminationStatus == 0,let result=result {done(result)} else {self.status.stringValue = "Could not finish. "+String(text.suffix(1400))+"\nCheck your connection and retry. Your profile has not been reset."}}
            } catch {DispatchQueue.main.async {self.busy=false;self.buttons.forEach{$0.isEnabled=true};self.status.stringValue=error.localizedDescription}}
        }
    }
    @objc func check(){bridge("check"){r in self.status.stringValue="Git: \(r["git"] as? Bool == true ? "ready" : "install Apple Git tools below")\nBundled Codex: \(r["codex"] as? Bool == true ? "ready" : "unavailable — reinstall this app")\nCodex account: \(r["signed_in"] as? Bool == true ? "signed in" : "sign in below")\nNext: open the dashboard, join with an invite, and choose repositories. Existing profiles are preserved."}}
    @objc func login(){bridge("login"){_ in self.check()}}
    @objc func installGit(){
        guard confirm("Install Apple's Command Line Tools?","Apple will show its installer. This supplies Git; AIConnect does not need a full Xcode installation. Finish the installer, then click Check this Mac.") else{return}
        let p=Process();p.executableURL=URL(fileURLWithPath:"/usr/bin/xcode-select");p.arguments=["--install"]
        do{try p.run();status.stringValue="Follow Apple's installer, then Check this Mac. If tools are already installed, no installation is needed."}catch{status.stringValue=error.localizedDescription}
    }
    @objc func dashboard(){openDashboard("start")}
    @objc func settings(){openDashboard("settings")}
    func openDashboard(_ action:String){bridge(action){r in
        guard let raw=r["url"] as? String,let url=URL(string:raw),url.scheme=="http",url.host=="127.0.0.1" else{self.status.stringValue="Invalid dashboard URL";return}
        UserDefaults.standard.set(true,forKey:"openedDashboard")
        self.origin=url;self.window.contentView=self.web;self.web.load(URLRequest(url:url))
    }}
    @objc func integration(){bridge("integration"){r in
        guard r["repairable"] as? Bool == true,r["enabled"] as? Bool == true,let fingerprint=r["fingerprint"] as? String else{self.status.stringValue="Existing AIConnect entry is disabled or belongs to another profile. Review it in Codex settings; nothing was changed.";return}
        let path=r["expected_path"] as? String ?? ""
        guard self.confirm("Connect AIConnect to Codex?","Register this installed app's MCP server:\n\(path)\nOnly the aiconnect entry will be updated. Your network membership will not change.") else{return}
        self.bridge("register:"+fingerprint){_ in self.status.stringValue="Connected. Reopen Codex desktop and start a new chat to use AIConnect. Codex desktop itself is optional and is installed separately."}
    }}
    @objc func notifications(){bridge("start"){_ in NSWorkspace.shared.open(self.resources.appendingPathComponent("AIConnect Menu.app"));self.status.stringValue="Use Enable notifications in the AIConnect menu. macOS may ask for permission."}}
    @objc func loginItems(){
        let a=NSAlert();a.messageText="Optional: open AIConnect at login";a.informativeText="In System Settings → General → Login Items, add AIConnect.app under Open at Login. The app starts your companion after you have completed setup once. This is optional; it does not install a privileged background service.";a.runModal()
        NSWorkspace.shared.open(URL(string:"x-apple.systempreferences:com.apple.LoginItems-Settings.extension")!)
    }
    @objc func stop(){guard confirm("Stop the companion?","New requests and routines cannot run until you open the dashboard again. Finish active tasks first. Membership and history will be kept.") else{return};bridge("stop"){_ in self.status.stringValue="Companion stopped. Open dashboard to start it again."}}
    func confirm(_ title:String,_ text:String)->Bool{let a=NSAlert();a.messageText=title;a.informativeText=text;a.addButton(withTitle:"Continue");a.addButton(withTitle:"Cancel");return a.runModal() == .alertFirstButtonReturn}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{loginProcess?.terminate();return .terminateNow}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool{window.makeKeyAndOrderFront(nil);return true}
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let url=action.request.url else{decisionHandler(.cancel);return}
        if url.scheme=="http",url.host=="127.0.0.1",url.port==origin?.port{decisionHandler(.allow);return}
        decisionHandler(.cancel)
        if action.navigationType == .linkActivated,url.scheme=="https",(url.fragment ?? "").isEmpty {NSWorkspace.shared.open(url)}
    }
    func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void){completionHandler(confirm("AIConnect",message))}
    func webView(_ webView:WKWebView,runJavaScriptAlertPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping()->Void){let a=NSAlert();a.messageText="AIConnect";a.informativeText=message;a.runModal();completionHandler()}
}
let app=NSApplication.shared
let delegate=DesktopApp()
app.delegate=delegate;app.setActivationPolicy(.regular);app.run()
