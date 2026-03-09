
const https = require('https');

const baseUrl = 'https://sistema-animebbg.vercel.app';

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, data }));
        }).on('error', reject);
    });
}

(async () => {
    console.log('Checking manifest...');

    // Check main page for link
    try {
        const { data } = await fetchUrl(baseUrl);
        if (data.includes('manifest.json')) {
            console.log('✅ Main page contains reference to manifest.json');
        } else {
            console.error('❌ Main page DOES NOT contain reference to manifest.json');
        }
    } catch (e) {
        console.error('Error fetching main page:', e.message);
    }

    // Check manifest file
    try {
        const { statusCode, headers, data } = await fetchUrl(`${baseUrl}/manifest.json`);
        console.log(`Manifest status: ${statusCode}`);
        console.log(`Content-Type: ${headers['content-type']}`);
        if (statusCode === 200) {
            console.log('✅ Manifest file is accessible');
            try {
                JSON.parse(data);
                console.log('✅ Manifest file is valid JSON');
            } catch (e) {
                console.error('❌ Manifest file is NOT valid JSON');
            }
        } else {
            console.error('❌ Manifest file is NOT accessible');
        }
    } catch (e) {
        console.error('Error fetching manifest:', e.message);
    }
})();
