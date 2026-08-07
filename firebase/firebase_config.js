// BeanHR Portal — Firebase Configuration
// This file is intentionally committed to the repo.
// Firebase web config is designed to be public — security is enforced by Firestore rules on Google's servers.
// ⚠️  Never put secret keys (Razorpay, Gemini, SendGrid) here — those go in backend/.env only.

const firebaseConfig = {
    apiKey:            "AIzaSyDdZHyY9_NDueeMRZE2K2XxOIM8gh2YcQk",
    authDomain:        "beanhr-portal.firebaseapp.com",
    projectId:         "beanhr-portal",
    storageBucket:     "beanhr-portal.firebasestorage.app",
    messagingSenderId: "1056336656581",
    appId:             "1:1056336656581:web:0887e592e541670163d8ac"
};
