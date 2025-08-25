
;; GreenGrant Smart Contract
;; A charity funding contract that releases donations to eco-projects only upon verified project milestones

;; Constants
(define-constant CONTRACT_OWNER tx-sender)
(define-constant ERR_OWNER_ONLY (err u100))
(define-constant ERR_PROJECT_NOT_FOUND (err u101))
(define-constant ERR_PROJECT_ALREADY_EXISTS (err u102))
(define-constant ERR_INVALID_STATUS (err u103))
(define-constant ERR_INSUFFICIENT_FUNDS (err u104))
(define-constant ERR_MILESTONE_NOT_FOUND (err u105))
(define-constant ERR_FUNDS_NOT_AVAILABLE (err u106))
(define-constant ERR_MILESTONE_NOT_VERIFIED (err u107))
(define-constant ERR_ALREADY_RELEASED (err u108))
(define-constant ERR_PROJECT_NOT_ACTIVE (err u109))

;; Project statuses
(define-constant PROJECT_STATUS_PENDING u0)
(define-constant PROJECT_STATUS_ACTIVE u1)
(define-constant PROJECT_STATUS_COMPLETED u2)
(define-constant PROJECT_STATUS_CANCELLED u3)

;; Data structures
(define-map projects 
  { project-id: uint }
  {
    owner: principal,
    title: (string-ascii 256),
    description: (string-ascii 1024),
    target-amount: uint,
    raised-amount: uint,
    status: uint,
    created-at: uint,
    category: (string-ascii 64)
  }
)

(define-map project-milestones
  { project-id: uint, milestone-id: uint }
  {
    title: (string-ascii 256),
    description: (string-ascii 512),
    amount: uint,
    verified: bool,
    verifier: (optional principal),
    verified-at: (optional uint),
    funds-released: bool,
    released-at: (optional uint)
  }
)

(define-map milestone-releases
  { project-id: uint, milestone-id: uint }
  {
    amount-released: uint,
    recipient: principal,
    released-by: principal,
    release-block: uint
  }
)

(define-map project-donations
  { project-id: uint, donor: principal }
  { amount: uint, donated-at: uint }
)

(define-map donor-totals
  { donor: principal }
  { total-donated: uint, projects-supported: uint }
)

;; Global variables
(define-data-var next-project-id uint u1)
(define-data-var contract-owner principal CONTRACT_OWNER)
(define-data-var total-platform-funds uint u0)

;; Private functions
(define-private (is-contract-owner)
  (is-eq tx-sender (var-get contract-owner))
)

;; Public functions

;; Register a new eco-project for funding
(define-public (register-project 
  (title (string-ascii 256))
  (description (string-ascii 1024))
  (target-amount uint)
  (category (string-ascii 64))
)
  (let ((project-id (var-get next-project-id)))
    ;; Validate inputs
    (asserts! (> (len title) u0) ERR_INVALID_STATUS)
    (asserts! (> (len description) u0) ERR_INVALID_STATUS)
    (asserts! (> (len category) u0) ERR_INVALID_STATUS)
    (asserts! (> target-amount u0) ERR_INVALID_STATUS)
    
    ;; Insert project into map
    (map-set projects 
      { project-id: project-id }
      {
        owner: tx-sender,
        title: title,
        description: description,
        target-amount: target-amount,
        raised-amount: u0,
        status: PROJECT_STATUS_PENDING,
        created-at: block-height,
        category: category
      }
    )
    
    ;; Increment project counter
    (var-set next-project-id (+ project-id u1))
    
    (ok project-id)
  )
)

;; Get project details
(define-read-only (get-project (project-id uint))
  (map-get? projects { project-id: project-id })
)

;; Get total number of projects
(define-read-only (get-total-projects)
  (- (var-get next-project-id) u1)
)

;; Check if user is project owner
(define-read-only (is-project-owner (project-id uint) (user principal))
  (match (map-get? projects { project-id: project-id })
    project (is-eq (get owner project) user)
    false
  )
)

;; Donate to a specific project
(define-public (donate-to-project (project-id uint) (amount uint))
  (let ((project (unwrap! (map-get? projects { project-id: project-id }) ERR_PROJECT_NOT_FOUND)))
    ;; Validate donation amount
    (asserts! (> amount u0) ERR_INSUFFICIENT_FUNDS)
    ;; Check project is active or pending (can receive donations)
    (asserts! (or (is-eq (get status project) PROJECT_STATUS_PENDING)
                  (is-eq (get status project) PROJECT_STATUS_ACTIVE)) ERR_INVALID_STATUS)
    
    ;; Transfer STX from donor to contract
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    
    ;; Update project raised amount
    (map-set projects 
      { project-id: project-id }
      (merge project { raised-amount: (+ (get raised-amount project) amount) })
    )
    
    ;; Record individual donation
    (map-set project-donations
      { project-id: project-id, donor: tx-sender }
      { amount: amount, donated-at: block-height }
    )
    
    ;; Update donor totals
    (match (map-get? donor-totals { donor: tx-sender })
      existing-donor (map-set donor-totals 
        { donor: tx-sender }
        { 
          total-donated: (+ (get total-donated existing-donor) amount),
          projects-supported: (+ (get projects-supported existing-donor) u1)
        }
      )
      (map-set donor-totals 
        { donor: tx-sender }
        { total-donated: amount, projects-supported: u1 }
      )
    )
    
    ;; Update total platform funds
    (var-set total-platform-funds (+ (var-get total-platform-funds) amount))
    
    (ok amount)
  )
)

;; Add milestone to a project (only project owner)
(define-public (add-milestone 
  (project-id uint) 
  (milestone-id uint) 
  (title (string-ascii 256)) 
  (description (string-ascii 512)) 
  (amount uint)
)
  (let ((project (unwrap! (map-get? projects { project-id: project-id }) ERR_PROJECT_NOT_FOUND)))
    ;; Only project owner can add milestones
    (asserts! (is-eq (get owner project) tx-sender) ERR_OWNER_ONLY)
    ;; Validate inputs
    (asserts! (> (len title) u0) ERR_INVALID_STATUS)
    (asserts! (> (len description) u0) ERR_INVALID_STATUS)
    (asserts! (> amount u0) ERR_INVALID_STATUS)
    
    ;; Check milestone doesn't already exist
    (asserts! (is-none (map-get? project-milestones { project-id: project-id, milestone-id: milestone-id })) 
              ERR_PROJECT_ALREADY_EXISTS)
    
    ;; Add milestone
    (map-set project-milestones
      { project-id: project-id, milestone-id: milestone-id }
      {
        title: title,
        description: description,
        amount: amount,
        verified: false,
        verifier: none,
        verified-at: none,
        funds-released: false,
        released-at: none
      }
    )
    
    (ok milestone-id)
  )
)

;; Verify milestone completion (contract owner only)
(define-public (verify-milestone (project-id uint) (milestone-id uint))
  (let ((milestone (unwrap! (map-get? project-milestones { project-id: project-id, milestone-id: milestone-id }) 
                            ERR_MILESTONE_NOT_FOUND)))
    ;; Only contract owner can verify milestones
    (asserts! (is-contract-owner) ERR_OWNER_ONLY)
    ;; Check milestone isn't already verified
    (asserts! (not (get verified milestone)) ERR_INVALID_STATUS)
    
    ;; Mark milestone as verified
    (map-set project-milestones
      { project-id: project-id, milestone-id: milestone-id }
      (merge milestone {
        verified: true,
        verifier: (some tx-sender),
        verified-at: (some block-height)
      })
    )
    
    (ok true)
  )
)

;; Get milestone details
(define-read-only (get-milestone (project-id uint) (milestone-id uint))
  (map-get? project-milestones { project-id: project-id, milestone-id: milestone-id })
)

;; Get donation details
(define-read-only (get-donation (project-id uint) (donor principal))
  (map-get? project-donations { project-id: project-id, donor: donor })
)

;; Get donor statistics  
(define-read-only (get-donor-stats (donor principal))
  (default-to { total-donated: u0, projects-supported: u0 }
    (map-get? donor-totals { donor: donor }))
)

;; Get total platform funds
(define-read-only (get-platform-funds)
  (var-get total-platform-funds)
)

;; Update project status (project owner only)
(define-public (update-project-status (project-id uint) (new-status uint))
  (let ((project (unwrap! (map-get? projects { project-id: project-id }) ERR_PROJECT_NOT_FOUND)))
    ;; Only project owner can update status
    (asserts! (is-eq (get owner project) tx-sender) ERR_OWNER_ONLY)
    ;; Validate status values
    (asserts! (<= new-status PROJECT_STATUS_CANCELLED) ERR_INVALID_STATUS)
    
    ;; Update project status
    (map-set projects 
      { project-id: project-id }
      (merge project { status: new-status })
    )
    
    (ok new-status)
  )
)

;; Release funds for a verified milestone (contract owner only)
(define-public (release-milestone-funds (project-id uint) (milestone-id uint))
  (let (
    (project (unwrap! (map-get? projects { project-id: project-id }) ERR_PROJECT_NOT_FOUND))
    (milestone (unwrap! (map-get? project-milestones { project-id: project-id, milestone-id: milestone-id }) 
                        ERR_MILESTONE_NOT_FOUND))
  )
    ;; Only contract owner can release funds
    (asserts! (is-contract-owner) ERR_OWNER_ONLY)
    ;; Check milestone is verified
    (asserts! (get verified milestone) ERR_MILESTONE_NOT_VERIFIED)
    ;; Check funds haven't been released already
    (asserts! (not (get funds-released milestone)) ERR_ALREADY_RELEASED)
    ;; Check project is active
    (asserts! (is-eq (get status project) PROJECT_STATUS_ACTIVE) ERR_PROJECT_NOT_ACTIVE)
    ;; Check sufficient funds available
    (asserts! (>= (get raised-amount project) (get amount milestone)) ERR_FUNDS_NOT_AVAILABLE)
    
    ;; Transfer funds from contract to project owner
    (try! (as-contract (stx-transfer? (get amount milestone) tx-sender (get owner project))))
    
    ;; Mark milestone funds as released
    (map-set project-milestones
      { project-id: project-id, milestone-id: milestone-id }
      (merge milestone {
        funds-released: true,
        released-at: (some block-height)
      })
    )
    
    ;; Record release details
    (map-set milestone-releases
      { project-id: project-id, milestone-id: milestone-id }
      {
        amount-released: (get amount milestone),
        recipient: (get owner project),
        released-by: tx-sender,
        release-block: block-height
      }
    )
    
    ;; Update platform funds
    (var-set total-platform-funds (- (var-get total-platform-funds) (get amount milestone)))
    
    (ok (get amount milestone))
  )
)

;; Emergency withdrawal (contract owner only)
(define-public (emergency-withdraw (amount uint))
  (begin
    ;; Only contract owner can withdraw
    (asserts! (is-contract-owner) ERR_OWNER_ONLY)
    ;; Check sufficient funds
    (asserts! (>= (var-get total-platform-funds) amount) ERR_INSUFFICIENT_FUNDS)
    
    ;; Transfer funds to contract owner
    (try! (as-contract (stx-transfer? amount tx-sender (var-get contract-owner))))
    
    ;; Update platform funds
    (var-set total-platform-funds (- (var-get total-platform-funds) amount))
    
    (ok amount)
  )
)

;; Get milestone release details
(define-read-only (get-milestone-release (project-id uint) (milestone-id uint))
  (map-get? milestone-releases { project-id: project-id, milestone-id: milestone-id })
)
