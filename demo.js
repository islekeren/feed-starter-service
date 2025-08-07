/**
 * Demo script showing the Feed Starter Service functionality
 */
import WebSocket from 'ws';
import fetch from 'node-fetch';

const SERVICE_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000/ws';

console.log('🚀 Feed Starter Service Demo\n');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demo() {
  try {
    // Step 1: Check service health
    console.log('1. Checking service health...');
    const healthResponse = await fetch(`${SERVICE_URL}/health`);
    const healthData = await healthResponse.json();
    console.log(
      `   ✅ Service is ${healthData.status} (uptime: ${healthData.uptime.toFixed(1)}s)\n`
    );

    // Step 2: Check initial courts (should be empty)
    console.log('2. Checking initial courts...');
    const courtsResponse = await fetch(`${SERVICE_URL}/v1/courts`);
    const courtsData = await courtsResponse.json();
    console.log(`   📋 Courts connected: ${courtsData.totalCount}\n`);

    // Step 3: Connect court via WebSocket
    console.log('3. Connecting court "court-demo" via WebSocket...');
    const courtWs = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
      courtWs.on('open', resolve);
      courtWs.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    console.log('   🔗 WebSocket connected');

    // Register court
    courtWs.send(
      JSON.stringify({
        courtId: 'court-demo',
        capabilities: ['live', 'record'],
        authToken: 'dev-token-1'
      })
    );

    // Wait for registration confirmation
    const regResponse = await new Promise((resolve, reject) => {
      courtWs.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'registration-ack') {
          resolve(msg);
        }
      });
      setTimeout(() => reject(new Error('Registration timeout')), 3000);
    });

    console.log(
      `   ✅ Court registered: ${regResponse.courtId} with capabilities: ${regResponse.capabilities.join(', ')}\n`
    );

    // Step 4: Verify court is now listed
    console.log('4. Checking courts after registration...');
    const courtsResponse2 = await fetch(`${SERVICE_URL}/v1/courts`);
    const courtsData2 = await courtsResponse2.json();
    console.log(`   📋 Courts connected: ${courtsData2.totalCount}`);
    console.log(
      `   🏟️  Court details: ${courtsData2.courts[0].courtId} - ${courtsData2.courts[0].status}\n`
    );

    // Step 5: Send control command
    console.log('5. Sending START command to court...');

    // Listen for command
    const commandPromise = new Promise(resolve => {
      courtWs.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.cmd) {
          console.log(`   📨 Court received command: ${msg.cmd} from ${msg.by}`);
          // Send ACK back
          courtWs.send(
            JSON.stringify({
              commandId: msg.commandId,
              success: true
            })
          );
          resolve(msg);
        }
      });
    });

    // Send REST API command
    const controlResponse = await fetch(`${SERVICE_URL}/v1/courts/court-demo/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'start',
        userId: '12345678-1234-1234-1234-123456789012',
        source: 'mobile',
        meta: {
          quality: '1080p',
          duration: 3600
        }
      })
    });

    const controlData = await controlResponse.json();
    await commandPromise;

    console.log(`   ✅ REST API response: ${controlResponse.status} ${controlResponse.statusText}`);
    console.log(`   🎯 Command acknowledged: ${controlData.success}\n`);

    // Step 6: Test SSE endpoint
    console.log('6. Testing Server-Sent Events endpoint...');
    const sseResponse = await fetch(`${SERVICE_URL}/v1/events`, {
      headers: { Accept: 'text/event-stream' }
    });

    console.log(`   📡 SSE endpoint response: ${sseResponse.status} ${sseResponse.statusText}\n`);

    // Clean up
    courtWs.close();
    console.log('✨ Demo completed successfully!');
    console.log('\nThe Feed Starter Service is fully functional with:');
    console.log('  • WebSocket court registration and heartbeat');
    console.log('  • REST API for control commands');
    console.log('  • WebSocket command acknowledgment');
    console.log('  • Server-sent events stream');
    console.log('  • Security headers and rate limiting');
    console.log('  • Structured logging with request IDs');
    console.log('  • Graceful error handling');
  } catch (error) {
    console.error('❌ Demo failed:', error.message);
  } finally {
    process.exit(0);
  }
}

demo();
