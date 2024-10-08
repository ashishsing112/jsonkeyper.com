function getType(obj) {
    if (Array.isArray(obj)) {
        return 'array';
    } else if (obj === null) {
        return 'null';
    } else {
        return typeof obj;
    }
}

function createMapping(prefix, obj, keyList) {
    const objType = getType(obj);
    if (obj !== "" && obj && (objType === 'object' || objType === 'array')) {
        if (objType === 'array') {
            for (let i = 0; i < obj.length; i++) {
                let arrayPrefix = `${prefix}[${i}]`;
                createMapping(arrayPrefix, obj[i], keyList);
            }
        } else if (objType === 'object') {
            dictIteration(obj, prefix, keyList);
        }
    }
}

function dictIteration(obj, prefix, keyList) {
    if ((getType(obj) !== 'string') && obj) {
        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                let value = obj[key];
                let fullKey = prefix ? prefix + '.' + key : key;
                keyList.push(fullKey);
                createMapping(fullKey, value, keyList);
            }
        }
    }
    return keyList;
}

function handleSubmit() {
    try {
        const input = document.getElementById("textbox1").value;
        if (!input.trim()) {
            showToast("Input cannot be empty. Please paste your JSON.");
            return;
        }
        let json;
        try {
            json = JSON.parse(input);
            if (typeof json !== 'object' || json === null) {
                throw new Error("Invalid JSON object");
            }
        } catch (e) {
            showToast("Invalid JSON format. Please check your input.");
            return;
        }
        let finalKeySet = dictIteration(json, '', []);
        document.getElementById('keysOutput').value = finalKeySet.join('\n');
    } catch (e) {
        showToast("Unexpected error occurred. Please try again.");
    }
}

function handleClear() {
    document.getElementById("textbox1").value = "";
    document.getElementById("keysOutput").value = "";
}

function openContactModal() {
    document.getElementById("contactModal").style.display = "block";
}

function closeContactModal() {
    document.getElementById("contactModal").style.display = "none";
    document.getElementById("email").value = "";
    document.getElementById("name").value = "";
    document.getElementById("message").value = "";
}

function sendContactForm() {
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const email = document.getElementById("email").value;
    if (!emailPattern.test(email)) {
        showToast("Please enter a valid email address.");
        return;
    }
    const name = document.getElementById("name").value;
    const message = document.getElementById("message").value;
    if (!name || !email || !message) {
        showToast("All fields are required.");
        return;
    }
    // Send email to developer
    const mailtoLink = `mailto:admin@jsonkeyper.com?subject=Feedback from ${encodeURIComponent(name)}&body=Email: ${encodeURIComponent(email)}%0D%0A%0D%0A${encodeURIComponent(message)}`;
    window.location.href = mailtoLink;
    closeContactModal();
}

function handleCopy() {
    const keysOutput = document.getElementById("keysOutput");
    if (!keysOutput.value) {
        showToast("Nothing to copy!");
        return;
    }
    if (navigator.clipboard && window.isSecureContext) {
        // Use navigator.clipboard API
        navigator.clipboard.writeText(keysOutput.value)
            .then(() => {
                showToast("Keys copied to clipboard!");
            })
            .catch(err => {
                showToast("Failed to copy text.");
            });
    } else {
        // Fallback method for older browsers
        keysOutput.select();
        keysOutput.setSelectionRange(0, keysOutput.value.length); // For mobile devices
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showToast("Keys copied to clipboard!");
            } else {
                showToast("Failed to copy text.");
            }
        } catch (err) {
            showToast("Failed to copy text.");
        }
    }
}

function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 2000);
}
