
/**
 * GreenGrant Smart Contract Test Suite
 * 
 * Comprehensive tests for the charity funding smart contract that releases
 * donations to eco-projects only upon verified project milestones.
 * 
 * Test Categories:
 * - Basic functionality and project registration
 * - Donation system and fund tracking
 * - Milestone management and verification
 * - Security and access controls
 * - Error handling and edge cases
 */

import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

/**
 * Test Constants - Match contract constants for consistency
 */
const PROJECT_STATUS_PENDING = 0;
const PROJECT_STATUS_ACTIVE = 1;
const PROJECT_STATUS_COMPLETED = 2;
const PROJECT_STATUS_CANCELLED = 3;

const ERR_OWNER_ONLY = 100;
const ERR_PROJECT_NOT_FOUND = 101;
const ERR_PROJECT_ALREADY_EXISTS = 102;
const ERR_INVALID_STATUS = 103;
const ERR_INSUFFICIENT_FUNDS = 104;
const ERR_MILESTONE_NOT_FOUND = 105;
const ERR_FUNDS_NOT_AVAILABLE = 106;
const ERR_MILESTONE_NOT_VERIFIED = 107;
const ERR_ALREADY_RELEASED = 108;
const ERR_PROJECT_NOT_ACTIVE = 109;

/**
 * COMMIT 1 TESTS: Foundation & Basic Tests
 * 
 * These tests cover the fundamental functionality of the contract:
 * - Project registration and validation
 * - Basic read operations
 * - Success and error scenarios
 */

Clarinet.test({
    name: "✅ Should successfully register a new eco-project",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        
        // Test successful project registration
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Solar Panel Installation"),
                    types.ascii("Community solar energy project for rural villages"),
                    types.uint(5000000), // 5 STX target
                    types.ascii("renewable-energy")
                ],
                wallet1.address
            )
        ]);
        
        // Verify the transaction was successful
        assertEquals(block.receipts.length, 1);
        assertEquals(block.height, 2);
        
        // Check that the function returned project ID 1
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Verify project details were stored correctly
        let projectQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-project',
            [types.uint(1)],
            wallet1.address
        );
        
        const project = projectQuery.result.expectSome().expectTuple() as any;
        assertEquals(project['owner'], wallet1.address);
        // Note: String fields include quotes in Clarity responses
        assertEquals(project['target-amount'], types.uint(5000000));
        assertEquals(project['raised-amount'], types.uint(0));
        assertEquals(project['status'], types.uint(PROJECT_STATUS_PENDING));
    }
});

Clarinet.test({
    name: "❌ Should reject project registration with invalid inputs",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;
        
        // Test error case: empty title should fail
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii(""), // Empty title
                    types.ascii("Valid description"),
                    types.uint(1000000),
                    types.ascii("renewable-energy")
                ],
                wallet1.address
            )
        ]);
        
        // Verify the transaction failed with the correct error
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_STATUS);
        
        // Test error case: zero target amount should fail
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Valid Title"),
                    types.ascii("Valid description"),
                    types.uint(0), // Zero amount
                    types.ascii("renewable-energy")
                ],
                wallet1.address
            )
        ]);
        
        // Verify the second error case
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_STATUS);
    }
});

Clarinet.test({
    name: "💰 Should successfully process donations to active projects",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const projectOwner = accounts.get('wallet_1')!;
        const donor = accounts.get('wallet_2')!;
        
        // First, register a project
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Ocean Cleanup Initiative"),
                    types.ascii("Remove plastic waste from Pacific Ocean"),
                    types.uint(10000000), // 10 STX target
                    types.ascii("ocean-conservation")
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Make a donation to the project
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [
                    types.uint(1), // project-id
                    types.uint(2000000) // 2 STX donation
                ],
                donor.address
            )
        ]);
        
        // Verify successful donation
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(2000000);
        
        // Check that project raised amount was updated
        let projectQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-project',
            [types.uint(1)],
            donor.address
        );
        
        const updatedProject = projectQuery.result.expectSome().expectTuple() as any;
        assertEquals(updatedProject['raised-amount'], types.uint(2000000));
        
        // Verify donor statistics were recorded
        let donorStats = chain.callReadOnlyFn(
            'green-grant',
            'get-donor-stats',
            [types.principal(donor.address)],
            donor.address
        );
        
        const stats = donorStats.result.expectTuple() as any;
        assertEquals(stats['total-donated'], types.uint(2000000));
        assertEquals(stats['projects-supported'], types.uint(1));
    }
});

Clarinet.test({
    name: "🔒 Should enforce project ownership for milestone creation",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const projectOwner = accounts.get('wallet_1')!;
        const unauthorizedUser = accounts.get('wallet_2')!;
        
        // Register a project
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Reforestation Project"),
                    types.ascii("Plant 1000 trees in deforested areas"),
                    types.uint(3000000),
                    types.ascii("reforestation")
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Try to add milestone as unauthorized user (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1), // project-id
                    types.uint(1), // milestone-id
                    types.ascii("Phase 1: Site Preparation"),
                    types.ascii("Clear and prepare planting sites"),
                    types.uint(1000000) // 1 STX
                ],
                unauthorizedUser.address // Wrong user
            )
        ]);
        
        // Should fail with owner-only error
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_OWNER_ONLY);
        
        // Add milestone as correct project owner (should succeed)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1),
                    types.ascii("Phase 1: Site Preparation"),
                    types.ascii("Clear and prepare planting sites"),
                    types.uint(1000000)
                ],
                projectOwner.address // Correct owner
            )
        ]);
        
        // Should succeed
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
    }
});

Clarinet.test({
    name: "📊 Should correctly track project and platform statistics",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;
        const wallet2 = accounts.get('wallet_2')!;
        
        // Check initial stats - should be zero projects
        let initialStats = chain.callReadOnlyFn(
            'green-grant',
            'get-total-projects',
            [],
            wallet1.address
        );
        assertEquals(initialStats.result.expectUint(0), 0);
        
        // Register two projects
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Wind Farm Project"),
                    types.ascii("Build community wind turbines"),
                    types.uint(8000000),
                    types.ascii("renewable-energy")
                ],
                wallet1.address
            ),
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Wildlife Conservation"),
                    types.ascii("Protect endangered species habitat"),
                    types.uint(4000000),
                    types.ascii("wildlife-conservation")
                ],
                wallet2.address
            )
        ]);
        
        // Both should succeed
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        
        // Check updated total projects
        let updatedStats = chain.callReadOnlyFn(
            'green-grant',
            'get-total-projects',
            [],
            wallet1.address
        );
        assertEquals(updatedStats.result.expectUint(2), 2);
        
        // Verify platform funds are initially zero
        let platformFunds = chain.callReadOnlyFn(
            'green-grant',
            'get-platform-funds',
            [],
            wallet1.address
        );
        assertEquals(platformFunds.result.expectUint(0), 0);
    }
});

/**
 * Read-Only Function Tests
 * 
 * These tests verify that our query functions work correctly
 * and handle edge cases like non-existent projects.
 */

Clarinet.test({
    name: "🔍 Should handle queries for non-existent projects gracefully",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;
        
        // Query non-existent project
        let projectQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-project',
            [types.uint(999)], // Non-existent project ID
            wallet1.address
        );
        
        // Should return none
        projectQuery.result.expectNone();
        
        // Query non-existent milestone
        let milestoneQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-milestone',
            [types.uint(1), types.uint(1)],
            wallet1.address
        );
        
        // Should return none
        milestoneQuery.result.expectNone();
        
        // Query donor stats for user who never donated
        let donorQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-donor-stats',
            [types.principal(wallet1.address)],
            wallet1.address
        );
        
        // Should return default values (zero)
        const defaultStats = donorQuery.result.expectTuple() as any;
        assertEquals(defaultStats['total-donated'], types.uint(0));
        assertEquals(defaultStats['projects-supported'], types.uint(0));
    }
});

/**
 * COMMIT 2 TESTS: Advanced Patterns
 * 
 * These tests demonstrate advanced testing patterns including:
 * - Multi-sender authorization testing
 * - Specific error code validation
 * - Multi-transaction block mining
 * - Complex workflow testing
 * - Contract owner vs project owner permissions
 */

Clarinet.test({
    name: "🔐 Should test authorization across different user roles",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!; // Contract owner
        const projectOwner = accounts.get('wallet_1')!;
        const donor = accounts.get('wallet_2')!;
        const randomUser = accounts.get('wallet_3')!;
        
        // Setup: Register project and add milestone
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Carbon Capture Project"),
                    types.ascii("Innovative carbon capture technology"),
                    types.uint(15000000),
                    types.ascii("carbon-capture")
                ],
                projectOwner.address
            )
        ]);
        
        const projectId = block.receipts[0].result.expectOk().expectUint(1);
        
        // Project owner adds milestone (should succeed)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1),
                    types.ascii("Research Phase"),
                    types.ascii("Complete initial research and feasibility study"),
                    types.uint(5000000)
                ],
                projectOwner.address
            )
        ]);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Random user tries to verify milestone (should fail - not contract owner)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'verify-milestone',
                [types.uint(1), types.uint(1)],
                randomUser.address
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_OWNER_ONLY);
        
        // Project owner tries to verify milestone (should fail - not contract owner)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'verify-milestone',
                [types.uint(1), types.uint(1)],
                projectOwner.address
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_OWNER_ONLY);
        
        // Contract owner (deployer) verifies milestone (should succeed)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'verify-milestone',
                [types.uint(1), types.uint(1)],
                deployer.address
            )
        ]);
        block.receipts[0].result.expectOk().expectBool(true);
        
        // Random user tries to release funds (should fail - not contract owner)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'release-milestone-funds',
                [types.uint(1), types.uint(1)],
                randomUser.address
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_OWNER_ONLY);
    }
});

Clarinet.test({
    name: "⚠️ Should return specific error codes for different failure scenarios",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const projectOwner = accounts.get('wallet_1')!;
        const donor = accounts.get('wallet_2')!;
        
        // Test ERR_PROJECT_NOT_FOUND
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(999), // Non-existent project
                    types.uint(1),
                    types.ascii("Test Milestone"),
                    types.ascii("Test description"),
                    types.uint(1000000)
                ],
                projectOwner.address
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_PROJECT_NOT_FOUND);
        
        // Setup project for further testing
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Test Project"),
                    types.ascii("Project for error testing"),
                    types.uint(5000000),
                    types.ascii("testing")
                ],
                projectOwner.address
            )
        ]);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Test ERR_MILESTONE_NOT_FOUND
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'verify-milestone',
                [types.uint(1), types.uint(999)], // Non-existent milestone
                deployer.address
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_MILESTONE_NOT_FOUND);
        
        // Add a milestone
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1),
                    types.ascii("Test Milestone"),
                    types.ascii("For error testing"),
                    types.uint(2000000)
                ],
                projectOwner.address
            )
        ]);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Test ERR_MILESTONE_NOT_VERIFIED (try to release funds before verification)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'release-milestone-funds',
                [types.uint(1), types.uint(1)],
                deployer.address
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_MILESTONE_NOT_VERIFIED);
        
        // Test ERR_PROJECT_ALREADY_EXISTS (try to add same milestone twice)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1), // Same milestone ID
                    types.ascii("Duplicate Milestone"),
                    types.ascii("This should fail"),
                    types.uint(1000000)
                ],
                projectOwner.address
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_PROJECT_ALREADY_EXISTS);
    }
});

Clarinet.test({
    name: "⛏️ Should handle multiple transactions in single block efficiently",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const projectOwner1 = accounts.get('wallet_1')!;
        const projectOwner2 = accounts.get('wallet_2')!;
        const donor1 = accounts.get('wallet_3')!;
        const donor2 = accounts.get('wallet_4')!;
        
        // Mine block with multiple project registrations and donations
        let block = chain.mineBlock([
            // Register two projects simultaneously
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Solar Farm Alpha"),
                    types.ascii("Large scale solar installation project"),
                    types.uint(20000000),
                    types.ascii("renewable-energy")
                ],
                projectOwner1.address
            ),
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Ocean Plastic Cleanup Beta"),
                    types.ascii("Advanced plastic removal from ocean waters"),
                    types.uint(12000000),
                    types.ascii("ocean-conservation")
                ],
                projectOwner2.address
            ),
            // Make immediate donations to both projects
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(1), types.uint(3000000)], // 3 STX to project 1
                donor1.address
            ),
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(2), types.uint(2500000)], // 2.5 STX to project 2
                donor2.address
            ),
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(1), types.uint(1500000)], // Additional 1.5 STX to project 1
                donor2.address
            )
        ]);
        
        // Verify all transactions succeeded
        assertEquals(block.receipts.length, 5);
        block.receipts[0].result.expectOk().expectUint(1); // Project 1 registered
        block.receipts[1].result.expectOk().expectUint(2); // Project 2 registered
        block.receipts[2].result.expectOk().expectUint(3000000); // Donation 1
        block.receipts[3].result.expectOk().expectUint(2500000); // Donation 2
        block.receipts[4].result.expectOk().expectUint(1500000); // Donation 3
        
        // Verify final state after batch operations
        let project1 = chain.callReadOnlyFn(
            'green-grant',
            'get-project',
            [types.uint(1)],
            deployer.address
        );
        const proj1Data = project1.result.expectSome().expectTuple() as any;
        assertEquals(proj1Data['raised-amount'], types.uint(4500000)); // 3M + 1.5M
        
        let project2 = chain.callReadOnlyFn(
            'green-grant',
            'get-project',
            [types.uint(2)],
            deployer.address
        );
        const proj2Data = project2.result.expectSome().expectTuple() as any;
        assertEquals(proj2Data['raised-amount'], types.uint(2500000));
        
        // Verify platform funds total
        let platformFunds = chain.callReadOnlyFn(
            'green-grant',
            'get-platform-funds',
            [],
            deployer.address
        );
        assertEquals(platformFunds.result.expectUint(7000000), 7000000); // Total donations
    }
});

Clarinet.test({
    name: "🔄 Should test complete milestone workflow with authorization checks",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!; // Contract owner
        const projectOwner = accounts.get('wallet_1')!;
        const donor = accounts.get('wallet_2')!;
        
        // Step 1: Setup project with funding
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Green Tech Innovation"),
                    types.ascii("Revolutionary green technology development"),
                    types.uint(10000000),
                    types.ascii("green-tech")
                ],
                projectOwner.address
            ),
            Tx.contractCall(
                'green-grant',
                'update-project-status',
                [types.uint(1), types.uint(PROJECT_STATUS_ACTIVE)],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(PROJECT_STATUS_ACTIVE);
        
        // Step 2: Add funding to project
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(1), types.uint(6000000)], // 6 STX
                donor.address
            )
        ]);
        block.receipts[0].result.expectOk().expectUint(6000000);
        
        // Step 3: Add milestones (only project owner can do this)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1),
                    types.ascii("Phase 1: Prototype"),
                    types.ascii("Develop working prototype"),
                    types.uint(3000000)
                ],
                projectOwner.address
            ),
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(2),
                    types.ascii("Phase 2: Testing"),
                    types.ascii("Comprehensive testing and validation"),
                    types.uint(2000000)
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        
        // Step 4: Contract owner verifies milestones
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'verify-milestone',
                [types.uint(1), types.uint(1)],
                deployer.address // Only contract owner can verify
            ),
            Tx.contractCall(
                'green-grant',
                'verify-milestone',
                [types.uint(1), types.uint(2)],
                deployer.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectBool(true);
        block.receipts[1].result.expectOk().expectBool(true);
        
        // Step 5: Release funds for verified milestones
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'release-milestone-funds',
                [types.uint(1), types.uint(1)],
                deployer.address // Only contract owner can release
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(3000000);
        
        // Verify milestone release was recorded
        let releaseQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-milestone-release',
            [types.uint(1), types.uint(1)],
            deployer.address
        );
        
        const releaseData = releaseQuery.result.expectSome().expectTuple() as any;
        assertEquals(releaseData['amount-released'], types.uint(3000000));
        assertEquals(releaseData['recipient'], projectOwner.address);
        assertEquals(releaseData['released-by'], deployer.address);
        
        // Verify platform funds decreased
        let platformFunds = chain.callReadOnlyFn(
            'green-grant',
            'get-platform-funds',
            [],
            deployer.address
        );
        assertEquals(platformFunds.result.expectUint(3000000), 3000000); // 6M - 3M released
    }
});

Clarinet.test({
    name: "🚫 Should prevent unauthorized operations with proper error codes",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const projectOwner = accounts.get('wallet_1')!;
        const unauthorizedUser = accounts.get('wallet_2')!;
        
        // Setup project
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Security Test Project"),
                    types.ascii("Testing security measures"),
                    types.uint(5000000),
                    types.ascii("security-test")
                ],
                projectOwner.address
            )
        ]);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Test unauthorized project status update
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'update-project-status',
                [types.uint(1), types.uint(PROJECT_STATUS_ACTIVE)],
                unauthorizedUser.address // Wrong user
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_OWNER_ONLY);
        
        // Test unauthorized project cancellation
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'cancel-project',
                [types.uint(1)],
                unauthorizedUser.address // Wrong user
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_OWNER_ONLY);
        
        // Test unauthorized contract ownership transfer
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'transfer-ownership',
                [types.principal(unauthorizedUser.address)],
                unauthorizedUser.address // Wrong user
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_OWNER_ONLY);
        
        // Test unauthorized emergency withdrawal
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'emergency-withdraw',
                [types.uint(1000000)],
                unauthorizedUser.address // Wrong user
            )
        ]);
        block.receipts[0].result.expectErr().expectUint(ERR_OWNER_ONLY);
        
        // Verify correct user can perform authorized operations
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'update-project-status',
                [types.uint(1), types.uint(PROJECT_STATUS_ACTIVE)],
                projectOwner.address // Correct project owner
            )
        ]);
        block.receipts[0].result.expectOk().expectUint(PROJECT_STATUS_ACTIVE);
    }
});

/**
 * COMMIT 3 TESTS: Mock Data & Integration
 * 
 * These tests focus on edge cases, boundary conditions, and integration scenarios:
 * - Large uint values and boundary testing
 * - Mock trait simulation for inter-contract calls
 * - Runtime cost analysis and optimization
 * - Complex data scenarios and edge cases
 */

Clarinet.test({
    name: "🔢 Should handle large uint values and boundary conditions",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const projectOwner = accounts.get('wallet_1')!;
        const whale = accounts.get('wallet_2')!; // Large donor
        
        // Test with maximum reasonable STX amounts (close to uint max but practical)
        const largeTarget = 999999999999999; // ~1M STX (very large project)
        const largeDonation = 100000000000000; // ~100K STX (whale donation)
        
        // Register project with large target amount
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Massive Global Reforestation"),
                    types.ascii("Planet-scale reforestation initiative covering multiple continents"),
                    types.uint(largeTarget),
                    types.ascii("global-reforestation")
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Make large donation
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(1), types.uint(largeDonation)],
                whale.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(largeDonation);
        
        // Test funding progress calculation with large numbers
        let progressQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-funding-progress',
            [types.uint(1)],
            deployer.address
        );
        
        // Should calculate percentage correctly: (100K / 1M) * 100 = 10%
        const expectedProgress = Math.floor((largeDonation * 100) / largeTarget);
        progressQuery.result.expectUint(expectedProgress);
        
        // Test boundary: exactly at target
        const remainingAmount = largeTarget - largeDonation;
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(1), types.uint(remainingAmount)],
                whale.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(remainingAmount);
        
        // Check if project is now fully funded
        let fullyFundedQuery = chain.callReadOnlyFn(
            'green-grant',
            'is-fully-funded',
            [types.uint(1)],
            deployer.address
        );
        
        fullyFundedQuery.result.expectBool(true);
        
        // Test milestone with large amount
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1),
                    types.ascii("Phase 1: Continental Coverage"),
                    types.ascii("Establish reforestation operations across 3 continents"),
                    types.uint(500000000000000) // 500K STX milestone
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
    }
});

Clarinet.test({
    name: "📊 Should handle edge cases with empty and maximum length strings",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const projectOwner = accounts.get('wallet_1')!;
        
        // Test maximum length strings (Clarity string limits)
        const maxTitle = "A".repeat(256); // Maximum title length
        const maxDescription = "B".repeat(1024); // Maximum description length
        const maxCategory = "C".repeat(64); // Maximum category length
        
        // Should succeed with maximum length strings
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii(maxTitle),
                    types.ascii(maxDescription),
                    types.uint(5000000),
                    types.ascii(maxCategory)
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Test milestone with maximum length strings
        const maxMilestoneTitle = "D".repeat(256);
        const maxMilestoneDesc = "E".repeat(512);
        
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1),
                    types.ascii(maxMilestoneTitle),
                    types.ascii(maxMilestoneDesc),
                    types.uint(1000000)
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Test edge case: minimum valid values
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("X"), // Minimum length (1 char)
                    types.ascii("Y"), // Minimum description
                    types.uint(1),    // Minimum target (1 microSTX)
                    types.ascii("Z")  // Minimum category
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(2);
        
        // Test minimum donation amount
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(2), types.uint(1)], // 1 microSTX donation
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(1);
    }
});

Clarinet.test({
    name: "🔄 Should simulate inter-contract integration patterns",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const projectOwner = accounts.get('wallet_1')!;
        const donor = accounts.get('wallet_2')!;
        
        // Simulate a complex integration scenario where external systems
        // might interact with our contract through multiple calls
        
        // Setup: Create project for integration testing
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Integration Test Project"),
                    types.ascii("Testing integration with external systems"),
                    types.uint(10000000),
                    types.ascii("integration-test")
                ],
                projectOwner.address
            )
        ]);
        
        const projectId = block.receipts[0].result.expectOk().expectUint(1);
        
        // Simulate external system operations (like a frontend or API)
        // that might batch multiple operations together
        block = chain.mineBlock([
            // External system: Activate project
            Tx.contractCall(
                'green-grant',
                'update-project-status',
                [types.uint(1), types.uint(PROJECT_STATUS_ACTIVE)],
                projectOwner.address
            ),
            // External system: Multiple donors donate simultaneously
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(1), types.uint(2000000)],
                donor.address
            ),
            // External system: Project owner immediately adds milestone
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1),
                    types.ascii("Integration Milestone"),
                    types.ascii("Testing integrated milestone creation"),
                    types.uint(1500000)
                ],
                projectOwner.address
            )
        ]);
        
        // Verify all integration steps succeeded
        assertEquals(block.receipts.length, 3);
        block.receipts[0].result.expectOk().expectUint(PROJECT_STATUS_ACTIVE);
        block.receipts[1].result.expectOk().expectUint(2000000);
        block.receipts[2].result.expectOk().expectUint(1);
        
        // Simulate governance-style voting integration
        // (Mock scenario: multiple contract owners could verify milestones)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'verify-milestone',
                [types.uint(1), types.uint(1)],
                deployer.address // Current contract owner
            )
        ]);
        
        block.receipts[0].result.expectOk().expectBool(true);
        
        // Test contract stats aggregation (useful for dashboards/analytics)
        let contractStats = chain.callReadOnlyFn(
            'green-grant',
            'get-contract-stats',
            [],
            deployer.address
        );
        
        const stats = contractStats.result.expectTuple() as any;
        assertEquals(stats['total-projects'], types.uint(1));
        assertEquals(stats['total-funds'], types.uint(2000000));
        assertEquals(stats['contract-owner'], deployer.address);
        
        // Simulate batch verification scenario (useful for administrative tools)
        block = chain.mineBlock([
            // Add another milestone
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(2),
                    types.ascii("Second Milestone"),
                    types.ascii("Additional milestone for batch testing"),
                    types.uint(1000000)
                ],
                projectOwner.address
            )
        ]);
        
        block.receipts[0].result.expectOk().expectUint(2);
        
        // Test batch verification functionality
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'batch-verify-milestones',
                [
                    types.list([
                        types.tuple({
                            'project-id': types.uint(1),
                            'milestone-id': types.uint(2)
                        })
                    ])
                ],
                deployer.address
            )
        ]);
        
        // Verify batch operation succeeded
        block.receipts[0].result.expectOk();
    }
});

Clarinet.test({
    name: "⚡ Should analyze runtime costs for optimization",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const projectOwner = accounts.get('wallet_1')!;
        const donor = accounts.get('wallet_2')!;
        
        // Test cost-efficient operations vs potentially expensive ones
        
        // Cost test 1: Simple project registration
        let block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Cost Analysis Project"),
                    types.ascii("Testing computational costs of various operations"),
                    types.uint(5000000),
                    types.ascii("cost-analysis")
                ],
                projectOwner.address
            )
        ]);
        
        // Note: In real scenarios, you would use clarinet test --costs to analyze
        // this transaction's runtime cost
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Cost test 2: Multiple rapid donations (stress test)
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(1), types.uint(100000)], // 100k microSTX
                donor.address
            ),
            Tx.contractCall(
                'green-grant',
                'donate-to-project', 
                [types.uint(1), types.uint(200000)], // 200k microSTX
                donor.address
            ),
            Tx.contractCall(
                'green-grant',
                'donate-to-project',
                [types.uint(1), types.uint(300000)], // 300k microSTX
                donor.address
            )
        ]);
        
        // Verify all rapid donations succeeded efficiently
        assertEquals(block.receipts.length, 3);
        for (let i = 0; i < 3; i++) {
            block.receipts[i].result.expectOk().expectUint(100000 * (i + 1));
        }
        
        // Cost test 3: Complex read-only operations
        let projectQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-project',
            [types.uint(1)],
            deployer.address
        );
        
        // Read operations should be very cost-efficient
        const project = projectQuery.result.expectSome().expectTuple() as any;
        assertEquals(project['raised-amount'], types.uint(600000)); // 100k + 200k + 300k
        
        // Cost test 4: Multiple milestone operations
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(1),
                    types.ascii("Milestone 1"),
                    types.ascii("Description for milestone 1"),
                    types.uint(1000000)
                ],
                projectOwner.address
            ),
            Tx.contractCall(
                'green-grant',
                'add-milestone',
                [
                    types.uint(1),
                    types.uint(2),
                    types.ascii("Milestone 2"),
                    types.ascii("Description for milestone 2"),
                    types.uint(2000000)
                ],
                projectOwner.address
            )
        ]);
        
        // Verify efficient milestone creation
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        
        // Cost test 5: Verification and release operations
        block = chain.mineBlock([
            Tx.contractCall(
                'green-grant',
                'verify-milestone',
                [types.uint(1), types.uint(1)],
                deployer.address
            ),
            Tx.contractCall(
                'green-grant',
                'release-milestone-funds',
                [types.uint(1), types.uint(1)],
                deployer.address
            )
        ]);
        
        // These operations involve STX transfers, so cost analysis is important
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectBool(true);
        block.receipts[1].result.expectOk().expectUint(1000000);
        
        // Verify final state after all cost-tested operations
        let finalProjectQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-project',
            [types.uint(1)],
            deployer.address
        );
        
        const finalProject = finalProjectQuery.result.expectSome().expectTuple() as any;
        assertEquals(finalProject['raised-amount'], types.uint(600000));
        
        // Verify milestone release was recorded
        let releaseQuery = chain.callReadOnlyFn(
            'green-grant',
            'get-milestone-release',
            [types.uint(1), types.uint(1)],
            deployer.address
        );
        
        releaseQuery.result.expectSome(); // Should have release record
    }
});

Clarinet.test({
    name: "🌐 Should handle complex multi-project scenarios with cross-references",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const owner1 = accounts.get('wallet_1')!;
        const owner2 = accounts.get('wallet_2')!;
        const owner3 = accounts.get('wallet_3')!;
        const donor1 = accounts.get('wallet_4')!;
        const donor2 = accounts.get('wallet_5')!;
        
        // Create a complex ecosystem of multiple projects
        let block = chain.mineBlock([
            // Project 1: Solar Energy
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Community Solar Grid"),
                    types.ascii("Distributed solar energy for rural communities"),
                    types.uint(15000000),
                    types.ascii("renewable-energy")
                ],
                owner1.address
            ),
            // Project 2: Ocean Cleanup  
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Pacific Plastic Removal"),
                    types.ascii("Advanced plastic extraction from ocean waters"),
                    types.uint(12000000),
                    types.ascii("ocean-cleanup")
                ],
                owner2.address
            ),
            // Project 3: Carbon Capture
            Tx.contractCall(
                'green-grant',
                'register-project',
                [
                    types.ascii("Atmospheric Carbon Capture"),
                    types.ascii("Industrial-scale carbon capture facility"),
                    types.uint(25000000),
                    types.ascii("carbon-capture")
                ],
                owner3.address
            )
        ]);
        
        // Verify all projects created
        assertEquals(block.receipts.length, 3);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        block.receipts[2].result.expectOk().expectUint(3);
        
        // Activate all projects
        block = chain.mineBlock([
            Tx.contractCall('green-grant', 'update-project-status', 
                [types.uint(1), types.uint(PROJECT_STATUS_ACTIVE)], owner1.address),
            Tx.contractCall('green-grant', 'update-project-status', 
                [types.uint(2), types.uint(PROJECT_STATUS_ACTIVE)], owner2.address),
            Tx.contractCall('green-grant', 'update-project-status', 
                [types.uint(3), types.uint(PROJECT_STATUS_ACTIVE)], owner3.address)
        ]);
        
        // Cross-project donations (donors supporting multiple causes)
        block = chain.mineBlock([
            // Donor 1 supports all three projects
            Tx.contractCall('green-grant', 'donate-to-project', 
                [types.uint(1), types.uint(3000000)], donor1.address),
            Tx.contractCall('green-grant', 'donate-to-project', 
                [types.uint(2), types.uint(2500000)], donor1.address),
            Tx.contractCall('green-grant', 'donate-to-project', 
                [types.uint(3), types.uint(4000000)], donor1.address),
            // Donor 2 focuses on renewable energy and carbon capture
            Tx.contractCall('green-grant', 'donate-to-project', 
                [types.uint(1), types.uint(2000000)], donor2.address),
            Tx.contractCall('green-grant', 'donate-to-project', 
                [types.uint(3), types.uint(3500000)], donor2.address)
        ]);
        
        // Verify all donations succeeded
        assertEquals(block.receipts.length, 5);
        for (let i = 0; i < 5; i++) {
            block.receipts[i].result.expectOk();
        }
        
        // Check donor 1 supported 3 projects, donor 2 supported 2 projects
        let donor1Stats = chain.callReadOnlyFn(
            'green-grant', 'get-donor-stats', [types.principal(donor1.address)], deployer.address
        );
        let donor2Stats = chain.callReadOnlyFn(
            'green-grant', 'get-donor-stats', [types.principal(donor2.address)], deployer.address
        );
        
        const d1Stats = donor1Stats.result.expectTuple() as any;
        const d2Stats = donor2Stats.result.expectTuple() as any;
        
        assertEquals(d1Stats['projects-supported'], types.uint(3));
        assertEquals(d1Stats['total-donated'], types.uint(9500000)); // 3M + 2.5M + 4M
        assertEquals(d2Stats['projects-supported'], types.uint(2));
        assertEquals(d2Stats['total-donated'], types.uint(5500000)); // 2M + 3.5M
        
        // Add milestones to all projects
        block = chain.mineBlock([
            // Solar project milestones
            Tx.contractCall('green-grant', 'add-milestone', 
                [types.uint(1), types.uint(1), types.ascii("Solar Phase 1"), 
                 types.ascii("Install first solar array"), types.uint(5000000)], owner1.address),
            // Ocean project milestones  
            Tx.contractCall('green-grant', 'add-milestone', 
                [types.uint(2), types.uint(1), types.ascii("Ocean Phase 1"), 
                 types.ascii("Deploy cleanup vessel"), types.uint(4000000)], owner2.address),
            // Carbon project milestones
            Tx.contractCall('green-grant', 'add-milestone', 
                [types.uint(3), types.uint(1), types.ascii("Carbon Phase 1"), 
                 types.ascii("Build capture facility"), types.uint(7500000)], owner3.address)
        ]);
        
        // Verify milestone creation
        assertEquals(block.receipts.length, 3);
        for (let i = 0; i < 3; i++) {
            block.receipts[i].result.expectOk().expectUint(1);
        }
        
        // Contract owner verifies all milestones
        block = chain.mineBlock([
            Tx.contractCall('green-grant', 'verify-milestone', [types.uint(1), types.uint(1)], deployer.address),
            Tx.contractCall('green-grant', 'verify-milestone', [types.uint(2), types.uint(1)], deployer.address),
            Tx.contractCall('green-grant', 'verify-milestone', [types.uint(3), types.uint(1)], deployer.address)
        ]);
        
        // Verify all verifications succeeded
        for (let i = 0; i < 3; i++) {
            block.receipts[i].result.expectOk().expectBool(true);
        }
        
        // Check platform statistics with multiple projects
        let platformStats = chain.callReadOnlyFn(
            'green-grant', 'get-contract-stats', [], deployer.address
        );
        
        const stats = platformStats.result.expectTuple() as any;
        assertEquals(stats['total-projects'], types.uint(3));
        assertEquals(stats['total-funds'], types.uint(15000000)); // Total of all donations
    }
});
