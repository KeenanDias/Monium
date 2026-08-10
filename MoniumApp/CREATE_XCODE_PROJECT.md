# Create Xcode Project - iOS App Bootstrap

**Time:** ~20 minutes  
**What you'll create:** SwiftUI Xcode project with dependencies and folder structure

---

## STEP 1: Create Xcode Project

Open Xcode and:
1. **File** → **New** → **Project**
2. Choose **iOS** → **App**
3. Configure:
   - **Product Name:** `MoniumApp`
   - **Team:** Select your Apple Developer account
   - **Organization Identifier:** `com.monium` (or your domain)
   - **Interface:** SwiftUI
   - **Language:** Swift
   - **Storage:** None (or CloudKit if you prefer)
4. Click **Create** → Save to `c:\Users\diask\Desktop\funsies\monium\MoniumApp`

---

## STEP 2: Add Package Dependencies

In Xcode:
1. **File** → **Add Packages**
2. Enter these URLs (one at a time):

### Plaid SDK
```
https://github.com/plaid/plaid-link-ios.git
```
- Choose version 4.0.0 or up
- Click "Add Package"

### AWS SDK for Swift
```
https://github.com/aws-amplify/aws-sdk-swift.git
```
- Choose version 0.1.0 or up
- Select targets: `MoniumApp`
- Click "Add Package"

**After adding:**
1. Select target **MoniumApp**
2. Go to **Build Phases** → **Link Binary With Libraries**
3. Verify `PlaidLink` and AWS SDK libraries are listed

---

## STEP 3: Create Folder Structure

In Xcode, create these folders:

```
MoniumApp/
├── App/
│   └── MoniumApp.swift (main entry point - already exists)
├── Models/
│   ├── User.swift
│   ├── KYCData.swift
│   ├── SafeToSpend.swift
│   └── Transaction.swift
├── Services/
│   ├── APIService.swift
│   ├── KeychainService.swift
│   └── PlaidService.swift
├── Views/
│   ├── Auth/
│   │   ├── LoginView.swift
│   │   └── RegisterView.swift
│   ├── Onboarding/
│   │   └── KYCView.swift
│   ├── Plaid/
│   │   └── PlaidLinkView.swift
│   ├── Dashboard/
│   │   └── DashboardView.swift
│   └── ContentView.swift (root navigation)
├── Utilities/
│   └── Constants.swift
└── Assets/ (already exists)
```

Right-click each folder name and select **New File** → select folder type, or just create `.swift` files.

---

## STEP 4: Create Core Files

### `Models/User.swift`
```swift
import Foundation

struct User: Codable {
    let userId: String
    let email: String
    let token: String
    var kyc: KYCData?
    var safeToSpend: SafeToSpendModel?
}

struct KYCData: Codable {
    let name: String
    let age: Int
    let income: Double
    let jobTitle: String
    let goal: String
    let completedAt: String
}

struct SafeToSpendModel: Codable {
    let monthlyIncome: Double
    let mandatorySpending: Double
    let monthlySavings: Double
    let availableForSpending: Double
    let safeToSpendDaily: Double
    let categoryBreakdown: [String: Double]?
    let calculatedAt: String
}
```

### `Models/Transaction.swift`
```swift
import Foundation

struct Transaction: Codable, Identifiable {
    let id: String
    let name: String
    let amount: Double
    let date: String
    let category: String?
}

enum TransactionCategory: String, CaseIterable {
    case bill = "Bill"
    case subscription = "Subscription"
    case entertainment = "Entertainment"
    case food = "Food"
    case transport = "Transport"
    case healthcare = "Healthcare"
    case shopping = "Shopping"
    case other = "Other"
}
```

### `Utilities/Constants.swift`
```swift
import Foundation

struct Constants {
    // Replace with your actual API Gateway URL from api-config.json
    static let API_BASE_URL = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod"
    
    // Plaid configuration
    static let PLAID_CLIENT_ID = "YOUR_PLAID_CLIENT_ID"
    
    // Keychain keys
    static let KEYCHAIN_JWT_TOKEN = "com.monium.jwt.token"
    static let KEYCHAIN_USER_ID = "com.monium.user.id"
}
```

### `Services/KeychainService.swift`
```swift
import Foundation
import Security

class KeychainService {
    static let shared = KeychainService()
    
    func save(_ value: String, forKey key: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]
        
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
    
    func retrieve(forKey key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true
        ]
        
        var result: AnyObject?
        SecItemCopyMatching(query as CFDictionary, &result)
        
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    
    func delete(forKey key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

### `Services/APIService.swift`
```swift
import Foundation

class APIService {
    static let shared = APIService()
    private var baseURL = Constants.API_BASE_URL
    
    // MARK: - Auth
    func authenticate(email: String, password: String, action: String) async throws -> User {
        let endpoint = "\(baseURL)/auth"
        
        let body: [String: Any] = [
            "email": email,
            "password": password,
            "action": action
        ]
        
        let data = try JSONSerialization.data(withJSONObject: body)
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        
        let (responseData, _) = try await URLSession.shared.data(for: request)
        let result = try JSONDecoder().decode(User.self, from: responseData)
        
        return result
    }
    
    // MARK: - KYC
    func submitKYC(userId: String, name: String, age: Int, income: Double, jobTitle: String, goal: String) async throws {
        let endpoint = "\(baseURL)/kyc"
        
        let body: [String: Any] = [
            "userId": userId,
            "name": name,
            "age": age,
            "income": income,
            "jobTitle": jobTitle,
            "goal": goal
        ]
        
        let data = try JSONSerialization.data(withJSONObject: body)
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        
        _ = try await URLSession.shared.data(for: request)
    }
    
    // MARK: - Plaid
    func getPlaidLinkToken(userId: String) async throws -> String {
        let endpoint = "\(baseURL)/plaid"
        
        let body: [String: String] = ["userId": userId]
        let data = try JSONSerialization.data(withJSONObject: body)
        
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        
        let (responseData, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(["link_token": String].self, from: responseData)
        
        return response["link_token"] ?? ""
    }
    
    // MARK: - Process Transactions
    func processPlaidData(userId: String, publicToken: String, plaidClientId: String) async throws -> SafeToSpendModel {
        let endpoint = "\(baseURL)/process-transactions"
        
        let body: [String: String] = [
            "userId": userId,
            "plaidAccessToken": publicToken,
            "plaidClientId": plaidClientId
        ]
        
        let data = try JSONSerialization.data(withJSONObject: body)
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        
        let (responseData, _) = try await URLSession.shared.data(for: request)
        let result = try JSONDecoder().decode(SafeToSpendModel.self, from: responseData)
        
        return result
    }
}
```

### `Views/ContentView.swift`
```swift
import SwiftUI

struct ContentView: View {
    @State private var userId: String? = nil
    @State private var isLoggedIn = false
    
    var body: some View {
        if isLoggedIn, let userId = userId {
            DashboardView(userId: userId)
        } else {
            LoginView(isLoggedIn: $isLoggedIn, userId: $userId)
        }
    }
}

#Preview {
    ContentView()
}
```

---

## STEP 5: Configure Project Settings

1. **Select MoniumApp target**
2. **General** tab:
   - Set **Minimum Deployment** to iOS 14.0+
   - Add your **Team ID**

3. **Signing & Capabilities**:
   - ✅ Automatically manage signing
   - Select your Team

4. **Go to Build Settings**:
   - Search for "Swift Language Version"
   - Set to Swift 5.9+

---

## STEP 6: Update MoniumApp.swift

Replace the default with:

```swift
import SwiftUI

@main
struct MoniumApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

---

## STEP 7: Configure Info.plist

Add these keys (in Xcode Info.plist editor):

1. **Plaid scheme** (for Plaid SDK):
   - Add URL Scheme: `monium` or `com.plaid`
   
2. **Add to project Info.plist**:
   ```xml
   <key>NSLocalNetworkUsageDescription</key>
   <string>Monium needs to connect to your financial institutions</string>
   ```

---

## STEP 8: Test Build

Press `Cmd + B` to build the project.

**Expected:** Build succeeds with 0 errors

---

## ✅ SUCCESS CHECKLIST

- [ ] Xcode project created
- [ ] Package dependencies added (Plaid, AWS SDK)
- [ ] Folder structure created
- [ ] Core models created
- [ ] Services created (API, Keychain)
- [ ] Views created
- [ ] Project builds without errors
- [ ] Apple Developer Team selected
- [ ] Info.plist configured

---

## 📱 NEXT: BUILD AUTH FLOW

Once this is done, open [IMPLEMENT_AUTH_FLOW.md](IMPLEMENT_AUTH_FLOW.md) to build the login/register views.

---

## 🧪 QUICK TEST

Before moving on, test that your API endpoint is correct:

```swift
// In MoniumApp.swift
Task {
    do {
        let user = try await APIService.shared.authenticate(
            email: "test@example.com",
            password: "pass123",
            action: "register"
        )
        print("✅ API works! User: \(user.userId)")
    } catch {
        print("❌ API error: \(error)")
    }
}
```

If it works, you're ready to move on! 🚀
