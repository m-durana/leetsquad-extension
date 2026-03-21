"""
Test script to understand LeetCode's GraphQL API requirements
"""
import requests
import json

LEETCODE_GRAPHQL = "https://leetcode.com/graphql"

# Test with a known active user
test_user = "lee215"

# Test 1: userProfileUserQuestionProgressV2 with full fields
print("Test 1: userProfileUserQuestionProgressV2 (full)")
query1 = """
query userProfileUserQuestionProgressV2($userSlug: String!) {
    userProfileUserQuestionProgressV2(userSlug: $userSlug) {
        numAcceptedQuestions {
            count
            difficulty
        }
        numFailedQuestions {
            count
            difficulty
        }
        userSessionBeatsPercentage {
            difficulty
            percentage
        }
        totalQuestionBeatsPercentage
    }
}
"""
try:
    response = requests.post(
        LEETCODE_GRAPHQL,
        json={"query": query1, "variables": {"userSlug": test_user}},
        headers={"Content-Type": "application/json"}
    )
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:1000]}")
except Exception as e:
    print(f"Error: {e}")

print("\n" + "="*50 + "\n")

# Test 2: submissionDetails (requires submission ID, likely auth too)
print("Test 2: submissionDetails (submission ID from test 1)")
# Get a submission ID first
query_subs = """
query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
        id
        title
    }
}
"""
try:
    response = requests.post(
        LEETCODE_GRAPHQL,
        json={"query": query_subs, "variables": {"username": test_user, "limit": 1}},
        headers={"Content-Type": "application/json"}
    )
    sub_data = response.json()
    sub_id = sub_data.get("data", {}).get("recentAcSubmissionList", [{}])[0].get("id")
    print(f"Found submission ID: {sub_id}")

    if sub_id:
        query2 = """
        query submissionDetails($submissionId: Int!) {
            submissionDetails(submissionId: $submissionId) {
                runtimePercentile
                memoryPercentile
            }
        }
        """
        response = requests.post(
            LEETCODE_GRAPHQL,
            json={"query": query2, "variables": {"submissionId": int(sub_id)}},
            headers={"Content-Type": "application/json"}
        )
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)[:500]}")
except Exception as e:
    print(f"Error: {e}")

print("\n" + "="*50 + "\n")

# Test 3: Combined query with runtime/memory in recentAcSubmissionList
print("Test 3: recentAcSubmissionList with runtime/memory (no percentile)")
query3 = """
query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
        id
        title
        titleSlug
        timestamp
        lang
        runtime
        memory
    }
}
"""
try:
    response = requests.post(
        LEETCODE_GRAPHQL,
        json={"query": query3, "variables": {"username": test_user, "limit": 3}},
        headers={"Content-Type": "application/json"}
    )
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:800]}")
except Exception as e:
    print(f"Error: {e}")
