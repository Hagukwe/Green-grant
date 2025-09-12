
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
